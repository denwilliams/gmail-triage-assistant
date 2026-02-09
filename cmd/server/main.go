package main

import (
	"fmt"
	"log"
	"os"

	"github.com/den/gmail-triage-assistant/internal/config"
	"github.com/den/gmail-triage-assistant/internal/database"
)

func main() {
	log.Println("Starting Gmail Triage Assistant...")

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

	log.Printf("Database connected successfully")
	log.Printf("Server will run on: %s:%s", cfg.ServerHost, cfg.ServerPort)
	log.Println("Configuration loaded successfully")

	// TODO: Initialize web server
	// TODO: Initialize Gmail client
	// TODO: Initialize OpenAI client
	// TODO: Start email monitoring
	// TODO: Start scheduled tasks (wrap-ups, memories)

	fmt.Println("\n✓ Phase 1 setup complete!")
	fmt.Println("Next steps:")
	fmt.Println("  1. Create PostgreSQL database: createdb gmail_triage")
	fmt.Println("  2. Run migrations: psql -d gmail_triage -f migrations/001_initial_schema.sql")
	fmt.Println("  3. Copy .env.example to .env and configure DATABASE_URL")
	fmt.Println("  4. Continue with Phase 2: Gmail OAuth & API Integration")

	os.Exit(0)
}
