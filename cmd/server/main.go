package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/den/gmail-triage-assistant/internal/config"
	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/gmail"
	"github.com/den/gmail-triage-assistant/internal/web"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	gmailapi "google.golang.org/api/gmail/v1"
)

func main() {
	log.Println("Starting Gmail Triage Assistant...")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

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

	// Create OAuth config
	oauthConfig := &oauth2.Config{
		ClientID:     cfg.GoogleClientID,
		ClientSecret: cfg.GoogleClientSecret,
		RedirectURL:  cfg.GoogleRedirectURL,
		Scopes: []string{
			gmailapi.GmailModifyScope,
			"https://www.googleapis.com/auth/userinfo.email",
		},
		Endpoint: google.Endpoint,
	}

	// Create message handler (placeholder for now)
	messageHandler := func(ctx context.Context, user *database.User, message *gmail.Message) error {
		log.Printf("[%s] Processing message: %s - %s", user.Email, message.From, message.Subject)
		// TODO: Implement AI pipeline here
		return nil
	}

	// Initialize multi-user Gmail monitor
	checkInterval := time.Duration(cfg.GmailCheckInterval) * time.Minute
	monitor := gmail.NewMultiUserMonitor(db, oauthConfig, checkInterval, messageHandler)

	// Initialize web server
	server := web.NewServer(db, cfg)

	log.Printf("✓ Multi-user Gmail monitor initialized (checking every %v)", checkInterval)
	log.Printf("✓ Web server ready on: http://%s:%s", cfg.ServerHost, cfg.ServerPort)

	// TODO: Initialize OpenAI client
	// TODO: Start scheduled tasks (wrap-ups, memories)

	// Start Gmail monitor in background
	go func() {
		if err := monitor.Start(ctx); err != nil && err != context.Canceled {
			log.Printf("Gmail monitor stopped with error: %v", err)
		}
	}()

	// Start web server in background
	go func() {
		if err := server.Start(); err != nil {
			log.Fatalf("Web server stopped with error: %v", err)
		}
	}()

	log.Println("\n=== Gmail Triage Assistant Running ===")
	log.Printf("Web UI: http://%s:%s", cfg.ServerHost, cfg.ServerPort)
	log.Println("Monitoring Gmail for all authenticated users...")
	log.Println("Press Ctrl+C to stop")

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("\nShutting down gracefully...")
	cancel()
	time.Sleep(2 * time.Second)
	log.Println("Goodbye!")
}
