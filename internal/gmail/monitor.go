package gmail

import (
	"context"
	"fmt"
	"log"
	"time"
)

// Monitor continuously monitors Gmail for new messages
type Monitor struct {
	client        *Client
	checkInterval time.Duration
	handler       MessageHandler
}

// MessageHandler is a callback function for handling new messages
type MessageHandler func(ctx context.Context, message *Message) error

// NewMonitor creates a new Gmail monitor
func NewMonitor(client *Client, checkInterval time.Duration, handler MessageHandler) *Monitor {
	return &Monitor{
		client:        client,
		checkInterval: checkInterval,
		handler:       handler,
	}
}

// Start begins monitoring for new messages
func (m *Monitor) Start(ctx context.Context) error {
	log.Printf("Starting Gmail monitor (checking every %v)", m.checkInterval)

	ticker := time.NewTicker(m.checkInterval)
	defer ticker.Stop()

	// Check immediately on start
	if err := m.checkForNewMessages(ctx); err != nil {
		log.Printf("Error checking for new messages: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			log.Println("Gmail monitor stopped")
			return ctx.Err()
		case <-ticker.C:
			if err := m.checkForNewMessages(ctx); err != nil {
				log.Printf("Error checking for new messages: %v", err)
			}
		}
	}
}

// checkForNewMessages fetches and processes unread messages
func (m *Monitor) checkForNewMessages(ctx context.Context) error {
	messages, err := m.client.GetUnreadMessages(ctx, 50)
	if err != nil {
		return fmt.Errorf("failed to get unread messages: %w", err)
	}

	if len(messages) == 0 {
		log.Println("No new messages")
		return nil
	}

	log.Printf("Found %d unread message(s)", len(messages))

	for _, message := range messages {
		if err := m.handler(ctx, message); err != nil {
			log.Printf("Error handling message %s: %v", message.ID, err)
			// Continue processing other messages even if one fails
			continue
		}
	}

	return nil
}

// History tracking (for future use with Gmail push notifications)
type HistoryMonitor struct {
	client    *Client
	historyID uint64
}

// NewHistoryMonitor creates a monitor using Gmail History API
func NewHistoryMonitor(client *Client, startHistoryID uint64) *HistoryMonitor {
	return &HistoryMonitor{
		client:    client,
		historyID: startHistoryID,
	}
}

// Note: Gmail History API and Push Notifications can be implemented later
// for more efficient real-time monitoring instead of polling
