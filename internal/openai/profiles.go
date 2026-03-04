package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/shared"
)

// ProfileBootstrapResult contains the AI-generated fields for a new profile
type ProfileBootstrapResult struct {
	SenderType string `json:"sender_type"`
	Summary    string `json:"summary"`
}

// ProfileUpdateContext carries the outcome of processing one email
type ProfileUpdateContext struct {
	From     string
	Subject  string
	Slug     string
	Keywords []string
	Labels   []string
	Archived bool
	Notified bool
	Summary  string
}

// BootstrapSenderProfile uses AI to classify a sender and generate a summary from historical emails
func (c *Client) BootstrapSenderProfile(ctx context.Context, identifier string, emails []*database.Email) (*ProfileBootstrapResult, error) {
	systemPrompt := `You are analyzing historical emails to create a sender profile.

Given the email history below, produce a JSON response:
{
  "sender_type": "human|newsletter|automated|marketing|notification",
  "summary": "2-3 sentence description of who this sender is, what they typically send, and how their emails should be handled"
}

Classify sender_type as:
- human: personal or professional correspondence from an individual
- newsletter: regular informational content or digests
- automated: system-generated messages (receipts, confirmations, alerts)
- marketing: promotional content, sales, offers
- notification: app/service notifications (social media, tools, etc.)`

	var emailLines []string
	for _, e := range emails {
		line := fmt.Sprintf("- From: %s | Subject: %s | Slug: %s | Labels: %s | Archived: %v",
			e.FromAddress, e.Subject, e.Slug, strings.Join(e.LabelsApplied, ", "), e.BypassedInbox)
		emailLines = append(emailLines, line)
	}

	userPrompt := fmt.Sprintf("Sender/Domain: %s\n\nHistorical emails (%d):\n%s",
		identifier, len(emails), strings.Join(emailLines, "\n"))

	c.logPrompts("BootstrapSenderProfile", systemPrompt, userPrompt)

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:        "profile_bootstrap",
					Description: param.NewOpt("Sender profile classification and summary"),
					Strict:      param.NewOpt(true),
					Schema: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"sender_type": map[string]interface{}{
								"type":        "string",
								"description": "Classification: human, newsletter, automated, marketing, or notification",
							},
							"summary": map[string]interface{}{
								"type":        "string",
								"description": "2-3 sentence description of the sender",
							},
						},
						"required":             []string{"sender_type", "summary"},
						"additionalProperties": false,
					},
				},
			},
		},
		MaxCompletionTokens: openai.Int(500),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	content := response.Choices[0].Message.Content
	if content == "" {
		return nil, fmt.Errorf("empty content from openai")
	}

	var result ProfileBootstrapResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse bootstrap response: %w", err)
	}

	return &result, nil
}

// EvolveProfileSummary updates a profile's summary and sender type based on a new email outcome
func (c *Client) EvolveProfileSummary(ctx context.Context, currentSummary string, senderType string, update *ProfileUpdateContext) (*ProfileBootstrapResult, error) {
	systemPrompt := `You are updating a sender profile after a new email was processed.

Given the current profile summary and a new email outcome, produce an updated JSON response:
{
  "sender_type": "human|newsletter|automated|marketing|notification",
  "summary": "updated 2-3 sentence summary"
}

Rules:
- Reinforce patterns that continue
- Note any changes in behavior
- Keep it to 2-3 sentences max
- Update sender_type only if behavior has clearly shifted`

	userPrompt := fmt.Sprintf(`Current sender type: %s
Current summary: %s

New email processed:
- From: %s
- Subject: %s
- Slug: %s
- Keywords: %s
- Labels applied: %s
- Archived: %v
- Notified: %v
- Summary: %s`,
		senderType, currentSummary,
		update.From, update.Subject, update.Slug,
		strings.Join(update.Keywords, ", "),
		strings.Join(update.Labels, ", "),
		update.Archived, update.Notified, update.Summary)

	c.logPrompts("EvolveProfileSummary", systemPrompt, userPrompt)

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:        "profile_update",
					Description: param.NewOpt("Updated sender profile classification and summary"),
					Strict:      param.NewOpt(true),
					Schema: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"sender_type": map[string]interface{}{
								"type":        "string",
								"description": "Classification: human, newsletter, automated, marketing, or notification",
							},
							"summary": map[string]interface{}{
								"type":        "string",
								"description": "Updated 2-3 sentence summary",
							},
						},
						"required":             []string{"sender_type", "summary"},
						"additionalProperties": false,
					},
				},
			},
		},
		MaxCompletionTokens: openai.Int(500),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	content := response.Choices[0].Message.Content
	if content == "" {
		return nil, fmt.Errorf("empty content from openai")
	}

	var result ProfileBootstrapResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse evolve response: %w", err)
	}

	return &result, nil
}
