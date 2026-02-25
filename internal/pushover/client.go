package pushover

import (
	"fmt"
	"net/http"
	"net/url"
)

const apiURL = "https://api.pushover.net/1/messages.json"

type Client struct{}

func NewClient() *Client {
	return &Client{}
}

// Send sends a push notification via the Pushover API using the provided per-user credentials.
func (c *Client) Send(userKey, appToken, title, message string) error {
	resp, err := http.PostForm(apiURL, url.Values{
		"token":   {appToken},
		"user":    {userKey},
		"title":   {title},
		"message": {message},
	})
	if err != nil {
		return fmt.Errorf("pushover request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("pushover returned status %d", resp.StatusCode)
	}

	return nil
}
