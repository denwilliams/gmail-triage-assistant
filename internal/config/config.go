package config

import (
	"fmt"
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
	OpenAIAPIKey   string
	OpenAIModel    string // Default: "gpt-4o-nano" or latest v5 nano model
	OpenAIBaseURL  string

	// Gmail settings
	GmailCheckInterval int // Minutes between email checks
}

// Load reads configuration from environment variables
func Load() (*Config, error) {
	cfg := &Config{
		ServerPort:         getEnv("SERVER_PORT", "8080"),
		ServerHost:         getEnv("SERVER_HOST", "localhost"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://localhost:5432/gmail_triage?sslmode=disable"),
		GoogleClientID:     getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/auth/callback"),
		OpenAIAPIKey:       getEnv("OPENAI_API_KEY", ""),
		OpenAIModel:        getEnv("OPENAI_MODEL", "gpt-4o-nano"),
		OpenAIBaseURL:      getEnv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
		GmailCheckInterval: getEnvInt("GMAIL_CHECK_INTERVAL", 5),
	}

	// Validate required fields
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.GoogleClientID == "" {
		return nil, fmt.Errorf("GOOGLE_CLIENT_ID is required")
	}
	if cfg.GoogleClientSecret == "" {
		return nil, fmt.Errorf("GOOGLE_CLIENT_SECRET is required")
	}
	if cfg.OpenAIAPIKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY is required")
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
