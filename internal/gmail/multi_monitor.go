package gmail

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"golang.org/x/oauth2"
)

// MultiUserMonitor monitors Gmail for multiple users
type MultiUserMonitor struct {
	db            *database.DB
	oauthConfig   *oauth2.Config
	checkInterval time.Duration
	handler       UserMessageHandler
}

// UserMessageHandler is a callback function for handling new messages for a specific user
type UserMessageHandler func(ctx context.Context, user *database.User, message *Message) error

// NewMultiUserMonitor creates a new multi-user Gmail monitor
func NewMultiUserMonitor(db *database.DB, oauthConfig *oauth2.Config, checkInterval time.Duration, handler UserMessageHandler) *MultiUserMonitor {
	return &MultiUserMonitor{
		db:            db,
		oauthConfig:   oauthConfig,
		checkInterval: checkInterval,
		handler:       handler,
	}
}

// Start begins monitoring Gmail for all active users
func (m *MultiUserMonitor) Start(ctx context.Context) error {
	log.Printf("Starting multi-user Gmail monitor (checking every %v)", m.checkInterval)

	ticker := time.NewTicker(m.checkInterval)
	defer ticker.Stop()

	// Check immediately on start
	if err := m.checkAllUsers(ctx); err != nil {
		log.Printf("Error checking users: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("Multi-user Gmail monitor stopped")
			return ctx.Err()
		case <-ticker.C:
			if err := m.checkAllUsers(ctx); err != nil {
				log.Printf("Error checking users: %v", err)
			}
		}
	}
}

// checkAllUsers fetches all active users and checks their Gmail
func (m *MultiUserMonitor) checkAllUsers(ctx context.Context) error {
	users, err := m.db.GetAllActiveUsers(ctx)
	if err != nil {
		return fmt.Errorf("failed to get active users: %w", err)
	}

	if len(users) == 0 {
		log.Println("No active users to monitor")
		return nil
	}

	log.Printf("Checking Gmail for %d active user(s)", len(users))

	// Process users concurrently
	var wg sync.WaitGroup
	for _, user := range users {
		wg.Add(1)
		go func(u *database.User) {
			defer wg.Done()
			if err := m.checkUserMessages(ctx, u); err != nil {
				log.Printf("Error checking messages for user %s: %v", u.Email, err)
			}
		}(user)
	}

	wg.Wait()
	return nil
}

// checkUserMessages checks Gmail messages for a single user
func (m *MultiUserMonitor) checkUserMessages(ctx context.Context, user *database.User) error {
	// Get user's OAuth token
	token := user.GetOAuth2Token()

	// Check if token needs refresh
	if time.Now().After(token.Expiry) {
		log.Printf("Token expired for user %s, refreshing...", user.Email)
		tokenSource := m.oauthConfig.TokenSource(ctx, token)
		newToken, err := tokenSource.Token()
		if err != nil {
			return fmt.Errorf("failed to refresh token: %w", err)
		}

		// Update token in database
		if err := m.db.UpdateUserToken(ctx, user.ID, newToken); err != nil {
			return fmt.Errorf("failed to update token in database: %w", err)
		}

		token = newToken
		log.Printf("Token refreshed for user %s", user.Email)
	}

	// Create Gmail client for this user
	client, err := NewClient(ctx, m.oauthConfig, token)
	if err != nil {
		return fmt.Errorf("failed to create Gmail client: %w", err)
	}

	// Get messages since last check
	// Note: last_checked_at always has a value (defaults to signup time in DB)
	var messages []*Message

	if user.LastCheckedAt == nil {
		// This should never happen due to DEFAULT in DB, but handle gracefully
		log.Printf("Warning: no last_checked_at for user %s, using current time", user.Email)
		now := time.Now()
		user.LastCheckedAt = &now
	}

	// Get messages since last check (InternalDate is in milliseconds)
	sinceMs := user.LastCheckedAt.UnixNano() / 1000000
	messages, err = client.GetMessagesSince(ctx, sinceMs, 50)
	if err != nil {
		return fmt.Errorf("failed to get messages since %v: %w", user.LastCheckedAt, err)
	}
	log.Printf("Checking for messages since %v for %s", user.LastCheckedAt.Format(time.RFC3339), user.Email)

	if len(messages) == 0 {
		log.Printf("No new messages for %s", user.Email)
		// Don't update timestamp - keep checking from the same point
		return nil
	}

	log.Printf("Found %d new message(s) for %s", len(messages), user.Email)

	// Find the newest email's timestamp to use as the new checkpoint
	var newestTimestamp int64 = 0
	for _, message := range messages {
		if message.InternalDate > newestTimestamp {
			newestTimestamp = message.InternalDate
		}
	}

	// Process each message
	for _, message := range messages {
		if err := m.handler(ctx, user, message); err != nil {
			log.Printf("Error handling message %s for user %s: %v", message.ID, user.Email, err)
			// Continue processing other messages even if one fails
			continue
		}
	}

	// Update last checked timestamp to the newest email's timestamp
	// InternalDate is in milliseconds, convert to time.Time
	newCheckpoint := time.Unix(0, newestTimestamp*1000000)
	if err := m.db.UpdateLastCheckedAt(ctx, user.ID, newCheckpoint); err != nil {
		log.Printf("Error updating last_checked_at for %s: %v", user.Email, err)
	} else {
		log.Printf("Updated checkpoint for %s to %v", user.Email, newCheckpoint.Format(time.RFC3339))
	}

	return nil
}
