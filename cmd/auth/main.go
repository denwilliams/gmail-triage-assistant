package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/den/gmail-triage-assistant/internal/config"
	"github.com/den/gmail-triage-assistant/internal/gmail"
)

func main() {
	log.Println("Gmail Triage Assistant - OAuth Setup")

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Check if token already exists
	if gmail.TokenExists() {
		fmt.Println("✓ Token file already exists (token.json)")
		fmt.Println("Delete token.json if you want to re-authenticate")
		os.Exit(0)
	}

	// Create OAuth config
	oauthConfig := gmail.GetOAuthConfig(
		cfg.GoogleClientID,
		cfg.GoogleClientSecret,
		cfg.GoogleRedirectURL,
	)

	// Get authorization URL
	authURL := gmail.GetAuthURL(oauthConfig)

	fmt.Println("\n=== Gmail OAuth Setup ===")
	fmt.Println("\n1. Visit this URL in your browser:")
	fmt.Printf("\n%s\n\n", authURL)
	fmt.Println("2. Authorize the application")
	fmt.Println("3. Copy the authorization code from the redirect URL")
	fmt.Print("\nEnter authorization code: ")

	var code string
	if _, err := fmt.Scan(&code); err != nil {
		log.Fatalf("Failed to read authorization code: %v", err)
	}

	// Exchange code for token
	ctx := context.Background()
	token, err := gmail.ExchangeCodeForToken(ctx, oauthConfig, code)
	if err != nil {
		log.Fatalf("Failed to exchange code for token: %v", err)
	}

	// Save token
	if err := gmail.SaveToken(token); err != nil {
		log.Fatalf("Failed to save token: %v", err)
	}

	fmt.Println("\n✓ Authentication successful!")
	fmt.Println("✓ Token saved to token.json")
	fmt.Println("\nYou can now run the main application.")
}
