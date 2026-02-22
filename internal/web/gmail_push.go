package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/gmail"
	"golang.org/x/oauth2"
)

// pubSubPayload is the outer Pub/Sub push message envelope
type pubSubPayload struct {
	Message struct {
		Data      string `json:"data"`
		MessageID string `json:"messageId"`
	} `json:"message"`
	Subscription string `json:"subscription"`
}

// gmailNotification is decoded from payload.Message.Data (base64)
type gmailNotification struct {
	EmailAddress string `json:"emailAddress"`
	HistoryID    uint64 `json:"historyId"`
}

func (s *Server) handleGmailPush(w http.ResponseWriter, r *http.Request) {
	// Verify the shared secret token
	token := r.URL.Query().Get("token")
	if token == "" || token != s.config.PubSubVerificationToken {
		log.Printf("Gmail push: unauthorized token")
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1MB limit
	if err != nil {
		log.Printf("Gmail push: failed to read body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	var payload pubSubPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("Gmail push: failed to parse body: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	// Decode base64 data field
	decoded, err := base64.StdEncoding.DecodeString(payload.Message.Data)
	if err != nil {
		log.Printf("Gmail push: failed to decode data: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	var notification gmailNotification
	if err := json.Unmarshal(decoded, &notification); err != nil {
		log.Printf("Gmail push: failed to parse notification: %v", err)
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	log.Printf("Gmail push: notification for %s, historyId=%d", notification.EmailAddress, notification.HistoryID)

	// Ack immediately — processing is best-effort, we don't want Pub/Sub to retry
	w.WriteHeader(http.StatusOK)

	// Process asynchronously so we return 200 before the work starts
	go func() {
		ctx := context.Background()
		if err := s.processGmailPushNotification(ctx, notification); err != nil {
			log.Printf("Gmail push: error processing notification for %s: %v", notification.EmailAddress, err)
		}
	}()
}

func (s *Server) processGmailPushNotification(ctx context.Context, notification gmailNotification) error {
	// Look up user by email
	user, err := s.db.GetUserByEmail(ctx, notification.EmailAddress)
	if err != nil {
		return fmt.Errorf("user not found for %s: %w", notification.EmailAddress, err)
	}

	if !user.IsActive {
		log.Printf("Gmail push: user %s is inactive, skipping", notification.EmailAddress)
		return nil
	}

	// Determine start history ID
	startHistoryID := notification.HistoryID - 1
	if user.GmailHistoryID != nil && *user.GmailHistoryID > 0 {
		startHistoryID = uint64(*user.GmailHistoryID)
	}

	// Build Gmail client for this user — refresh token if needed
	token := user.GetOAuth2Token()
	tokenSource := s.oauthConfig.TokenSource(ctx, token)
	freshToken, err := tokenSource.Token()
	if err != nil {
		return fmt.Errorf("failed to refresh token for %s: %w", notification.EmailAddress, err)
	}
	if freshToken.AccessToken != token.AccessToken {
		if err := s.db.UpdateUserToken(ctx, user.ID, freshToken); err != nil {
			log.Printf("Gmail push: failed to update token for %s: %v", notification.EmailAddress, err)
		}
	}

	gmailClient, err := gmail.NewClient(ctx, s.oauthConfig, freshToken)
	if err != nil {
		return fmt.Errorf("failed to create Gmail client: %w", err)
	}

	// Fetch new messages via History API
	messages, newHistoryID, err := gmailClient.GetMessagesByHistoryID(ctx, startHistoryID)
	if err != nil {
		return fmt.Errorf("failed to get messages by history ID: %w", err)
	}

	if len(messages) == 0 {
		log.Printf("Gmail push: no new messages for %s (historyId=%d)", notification.EmailAddress, notification.HistoryID)
	} else {
		log.Printf("Gmail push: processing %d message(s) for %s", len(messages), notification.EmailAddress)
	}

	// Process each message using the pipeline
	for _, msg := range messages {
		if err := s.processor.ProcessEmail(ctx, user, msg); err != nil {
			log.Printf("Gmail push: error processing message %s: %v", msg.ID, err)
			// Continue with other messages
		}
	}

	// Update history ID checkpoint
	if newHistoryID > 0 {
		if err := s.db.UpdateGmailHistoryID(ctx, user.ID, int64(newHistoryID)); err != nil {
			log.Printf("Gmail push: failed to update history ID: %v", err)
		}
	}

	return nil
}

// registerGmailWatch calls gmail.watch() for a user and stores the historyId.
// No-op if PubSubTopic is not configured.
func (s *Server) registerGmailWatch(ctx context.Context, user *database.User, token *oauth2.Token) error {
	if s.config.PubSubTopic == "" {
		return nil
	}

	gmailClient, err := gmail.NewClient(ctx, s.oauthConfig, token)
	if err != nil {
		return fmt.Errorf("failed to create Gmail client: %w", err)
	}

	historyID, _, err := gmailClient.WatchInbox(ctx, s.config.PubSubTopic)
	if err != nil {
		return fmt.Errorf("failed to register Gmail watch: %w", err)
	}

	if err := s.db.UpdateGmailHistoryID(ctx, user.ID, int64(historyID)); err != nil {
		return fmt.Errorf("failed to store history ID: %w", err)
	}

	log.Printf("Registered Gmail watch for %s (historyId=%d)", user.Email, historyID)
	return nil
}

// RenewGmailWatch renews the Gmail push watch for a user (called by cron).
func (s *Server) RenewGmailWatch(ctx context.Context, user *database.User) error {
	token := user.GetOAuth2Token()
	tokenSource := s.oauthConfig.TokenSource(ctx, token)
	freshToken, err := tokenSource.Token()
	if err != nil {
		return fmt.Errorf("failed to refresh token: %w", err)
	}
	return s.registerGmailWatch(ctx, user, freshToken)
}
