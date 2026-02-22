package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
)

type Config struct {
	// Server settings
	ServerPort string
	ServerHost string

	// Database settings
	DatabaseURL string

	// Google OAuth settings
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string

	// OpenAI settings
	OpenAIAPIKey  string
	OpenAIModel   string // Default: "gpt-4o-nano" or latest v5 nano model
	OpenAIBaseURL string

	// Gmail settings
	GmailCheckInterval int // Minutes between email checks

	// Session settings
	SessionSecret string

	// Gmail push notification settings (optional — if empty, falls back to polling)
	PubSubVerificationToken  string // Secret token to verify Pub/Sub pushes
	PubSubTopic              string // Full topic name: projects/PROJECT/topics/gmail-triage
	PushNotificationsEnabled bool   // When true, skip polling monitor
}

// Load reads configuration from environment variables
func Load() (*Config, error) {
	cfg := &Config{
		ServerPort:               getEnv("SERVER_PORT", "8080"),
		ServerHost:               getEnv("SERVER_HOST", "localhost"),
		DatabaseURL:              getEnv("DATABASE_URL", "postgres://localhost:5432/gmail_triage?sslmode=disable"),
		GoogleClientID:           getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:       getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:        getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/auth/callback"),
		OpenAIAPIKey:             getEnv("OPENAI_API_KEY", ""),
		OpenAIModel:              getEnv("OPENAI_MODEL", "gpt-4o-nano"),
		OpenAIBaseURL:            getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		GmailCheckInterval:       getEnvInt("GMAIL_CHECK_INTERVAL", 5),
		SessionSecret:            getEnv("SESSION_SECRET", "replace-with-32-byte-random-key-in-production"),
		PubSubVerificationToken:  getEnv("PUBSUB_VERIFICATION_TOKEN", ""),
		PubSubTopic:              getEnv("PUBSUB_TOPIC", ""),
		PushNotificationsEnabled: getEnv("PUSH_NOTIFICATIONS_ENABLED", "false") == "true",
	}

	if cfg.SessionSecret == "replace-with-32-byte-random-key-in-production" {
		log.Printf("WARNING: SESSION_SECRET is set to the default insecure value. Set a strong random secret for production.")
	}

	// Validate required fields
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.GoogleClientID == "" {
		return nil, fmt.Errorf("GOOGLE_CLIENT_ID is required - see README for Google Cloud setup instructions")
	}
	if cfg.GoogleClientSecret == "" {
		return nil, fmt.Errorf("GOOGLE_CLIENT_SECRET is required - see README for Google Cloud setup instructions")
	}
	// OpenAI is not required yet (Phase 3)
	// if cfg.OpenAIAPIKey == "" {
	//     return nil, fmt.Errorf("OPENAI_API_KEY is required")
	// }
	if cfg.PushNotificationsEnabled && cfg.PubSubVerificationToken == "" {
		return nil, fmt.Errorf("PUBSUB_VERIFICATION_TOKEN is required when PUSH_NOTIFICATIONS_ENABLED=true")
	}
	if cfg.PushNotificationsEnabled && cfg.PubSubTopic == "" {
		return nil, fmt.Errorf("PUBSUB_TOPIC is required when PUSH_NOTIFICATIONS_ENABLED=true")
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
