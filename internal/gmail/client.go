package gmail

import (
	"context"
	"fmt"

	"golang.org/x/oauth2"
	"google.golang.org/api/gmail/v1"
	"google.golang.org/api/option"
)

// Client wraps the Gmail API client
type Client struct {
	service *gmail.Service
	userID  string // "me" for authenticated user
}

// NewClient creates a new Gmail API client
func NewClient(ctx context.Context, config *oauth2.Config, token *oauth2.Token) (*Client, error) {
	httpClient := config.Client(ctx, token)

	service, err := gmail.NewService(ctx, option.WithHTTPClient(httpClient))
	if err != nil {
		return nil, fmt.Errorf("failed to create Gmail service: %w", err)
	}

	return &Client{
		service: service,
		userID:  "me",
	}, nil
}

// Message represents a simplified Gmail message
type Message struct {
	ID          string
	ThreadID    string
	Subject     string
	From        string
	Body        string
	LabelIDs    []string
	InternalDate int64
}

// GetUnreadMessages fetches unread messages from the inbox
func (c *Client) GetUnreadMessages(ctx context.Context, maxResults int64) ([]*Message, error) {
	query := "is:unread in:inbox"

	req := c.service.Users.Messages.List(c.userID).Q(query).MaxResults(maxResults)
	res, err := req.Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list messages: %w", err)
	}

	messages := make([]*Message, 0, len(res.Messages))
	for _, m := range res.Messages {
		msg, err := c.GetMessage(ctx, m.Id)
		if err != nil {
			return nil, fmt.Errorf("failed to get message %s: %w", m.Id, err)
		}
		messages = append(messages, msg)
	}

	return messages, nil
}

// GetMessage fetches a single message by ID
func (c *Client) GetMessage(ctx context.Context, messageID string) (*Message, error) {
	msg, err := c.service.Users.Messages.Get(c.userID, messageID).Format("full").Do()
	if err != nil {
		return nil, fmt.Errorf("failed to get message: %w", err)
	}

	message := &Message{
		ID:          msg.Id,
		ThreadID:    msg.ThreadId,
		LabelIDs:    msg.LabelIds,
		InternalDate: msg.InternalDate,
	}

	// Extract subject and from headers
	for _, header := range msg.Payload.Headers {
		switch header.Name {
		case "Subject":
			message.Subject = header.Value
		case "From":
			message.From = header.Value
		}
	}

	// Extract body
	message.Body = extractBody(msg.Payload)

	return message, nil
}

// extractBody extracts the plain text body from a message payload
func extractBody(payload *gmail.MessagePart) string {
	if payload.MimeType == "text/plain" && payload.Body.Data != "" {
		return payload.Body.Data
	}

	// Check parts recursively
	for _, part := range payload.Parts {
		if part.MimeType == "text/plain" && part.Body.Data != "" {
			return part.Body.Data
		}
		// Check nested parts
		if body := extractBody(part); body != "" {
			return body
		}
	}

	return ""
}

// AddLabels adds labels to a message
func (c *Client) AddLabels(ctx context.Context, messageID string, labelIDs []string) error {
	req := &gmail.ModifyMessageRequest{
		AddLabelIds: labelIDs,
	}

	_, err := c.service.Users.Messages.Modify(c.userID, messageID, req).Do()
	if err != nil {
		return fmt.Errorf("failed to add labels: %w", err)
	}

	return nil
}

// RemoveLabels removes labels from a message
func (c *Client) RemoveLabels(ctx context.Context, messageID string, labelIDs []string) error {
	req := &gmail.ModifyMessageRequest{
		RemoveLabelIds: labelIDs,
	}

	_, err := c.service.Users.Messages.Modify(c.userID, messageID, req).Do()
	if err != nil {
		return fmt.Errorf("failed to remove labels: %w", err)
	}

	return nil
}

// ArchiveMessage archives a message (removes from inbox)
func (c *Client) ArchiveMessage(ctx context.Context, messageID string) error {
	return c.RemoveLabels(ctx, messageID, []string{"INBOX"})
}

// ListLabels returns all labels for the user
func (c *Client) ListLabels(ctx context.Context) ([]*gmail.Label, error) {
	res, err := c.service.Users.Labels.List(c.userID).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to list labels: %w", err)
	}

	return res.Labels, nil
}

// GetLabelID finds a label ID by name, returns empty string if not found
func (c *Client) GetLabelID(ctx context.Context, labelName string) (string, error) {
	labels, err := c.ListLabels(ctx)
	if err != nil {
		return "", err
	}

	for _, label := range labels {
		if label.Name == labelName {
			return label.Id, nil
		}
	}

	return "", fmt.Errorf("label not found: %s", labelName)
}

// CreateLabel creates a new label
func (c *Client) CreateLabel(ctx context.Context, labelName string) (*gmail.Label, error) {
	label := &gmail.Label{
		Name:                   labelName,
		MessageListVisibility:  "show",
		LabelListVisibility:    "labelShow",
		Type:                   "user",
	}

	created, err := c.service.Users.Labels.Create(c.userID, label).Do()
	if err != nil {
		return nil, fmt.Errorf("failed to create label: %w", err)
	}

	return created, nil
}
