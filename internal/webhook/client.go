package webhook

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

// Client sends webhook notifications
type Client struct {
	httpClient *http.Client
}

// Payload is the JSON body sent to the webhook URL
type Payload struct {
	Title         string   `json:"title"`
	Message       string   `json:"message"`
	FromAddress   string   `json:"from_address"`
	EmailID       string   `json:"email_id"`
	Slug          string   `json:"slug"`
	Subject       string   `json:"subject"`
	LabelsApplied []string `json:"labels_applied"`
	ProcessedAt   string   `json:"processed_at"`
}

// NewClient creates a new webhook client with a 10s timeout
func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Send POSTs the payload as JSON to the webhook URL.
// If headerKey is non-empty, the custom header is included.
func (c *Client) Send(webhookURL, headerKey, headerValue string, payload Payload) error {
	// Validate URL scheme
	parsed, err := url.Parse(webhookURL)
	if err != nil {
		return fmt.Errorf("invalid webhook URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("webhook URL must use http or https scheme, got %q", parsed.Scheme)
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal webhook payload: %w", err)
	}

	req, err := http.NewRequest("POST", webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to create webhook request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if headerKey != "" {
		req.Header.Set(headerKey, headerValue)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("webhook request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}
