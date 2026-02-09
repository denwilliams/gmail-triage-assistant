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

	// Get unread messages
	messages, err := client.GetUnreadMessages(ctx, 50)
	if err != nil {
		return fmt.Errorf("failed to get unread messages: %w", err)
	}

	if len(messages) == 0 {
		log.Printf("No new messages for %s", user.Email)
		return nil
	}

	log.Printf("Found %d unread message(s) for %s", len(messages), user.Email)

	// Process each message
	for _, message := range messages {
		if err := m.handler(ctx, user, message); err != nil {
			log.Printf("Error handling message %s for user %s: %v", message.ID, user.Email, err)
			// Continue processing other messages even if one fails
			continue
		}
	}

	return nil
}
