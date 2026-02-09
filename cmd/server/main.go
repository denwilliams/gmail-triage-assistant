package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/den/gmail-triage-assistant/internal/config"
	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/gmail"
)

func main() {
	log.Println("Starting Gmail Triage Assistant...")

	ctx := context.Background()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize database
	db, err := database.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()

	log.Printf("✓ Database connected successfully")

	// Check if OAuth token exists
	if !gmail.TokenExists() {
		log.Fatalf("OAuth token not found. Run 'make auth' to authenticate with Gmail")
	}

	// Load OAuth token
	token, err := gmail.LoadToken()
	if err != nil {
		log.Fatalf("Failed to load OAuth token: %v", err)
	}

	// Create OAuth config
	oauthConfig := gmail.GetOAuthConfig(
		cfg.GoogleClientID,
		cfg.GoogleClientSecret,
		cfg.GoogleRedirectURL,
	)

	// Initialize Gmail client
	gmailClient, err := gmail.NewClient(ctx, oauthConfig, token)
	if err != nil {
		log.Fatalf("Failed to create Gmail client: %v", err)
	}

	log.Printf("✓ Gmail client initialized")

	// Create message handler (placeholder for now)
	messageHandler := func(ctx context.Context, message *gmail.Message) error {
		log.Printf("Processing message: %s - %s", message.From, message.Subject)
		// TODO: Implement AI pipeline here
		return nil
	}

	// Initialize Gmail monitor
	checkInterval := time.Duration(cfg.GmailCheckInterval) * time.Minute
	monitor := gmail.NewMonitor(gmailClient, checkInterval, messageHandler)

	log.Printf("✓ Gmail monitor initialized (checking every %v)", checkInterval)
	log.Printf("✓ Server ready on: %s:%s", cfg.ServerHost, cfg.ServerPort)

	// TODO: Initialize web server
	// TODO: Initialize OpenAI client
	// TODO: Start scheduled tasks (wrap-ups, memories)

	fmt.Println("\n=== Gmail Triage Assistant Running ===")
	fmt.Println("Monitoring Gmail for new messages...")
	fmt.Println("Press Ctrl+C to stop")

	// Start monitoring (blocks until context is cancelled)
	if err := monitor.Start(ctx); err != nil {
		log.Fatalf("Monitor stopped with error: %v", err)
	}
}
