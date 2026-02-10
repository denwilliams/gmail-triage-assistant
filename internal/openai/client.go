package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/shared"
)

type Client struct {
	client   openai.Client
	model    string
	debugLog bool
}

// NewClient creates a new OpenAI client
func NewClient(apiKey, model, baseURL string) *Client {
	client := openai.NewClient(option.WithAPIKey(apiKey))
	return &Client{
		client:   client,
		model:    model,
		debugLog: strings.Contains(os.Getenv("DEBUG"), "OPENAI"),
	}
}

func (c *Client) logPrompts(label, systemPrompt, userPrompt string) {
	if !c.debugLog {
		return
	}
	log.Printf("[OPENAI DEBUG] === %s ===\nSYSTEM:\n%s\n\nUSER:\n%s\n=== END %s ===", label, systemPrompt, userPrompt, label)
}

// EmailAnalysis represents the Stage 1 AI output
type EmailAnalysis struct {
	Slug     string   `json:"slug"`
	Keywords []string `json:"keywords"`
	Summary  string   `json:"summary"`
}

// EmailActions represents the Stage 2 AI output
type EmailActions struct {
	Labels      []string `json:"labels"`
	BypassInbox bool     `json:"bypass_inbox"`
	Reasoning   string   `json:"reasoning"`
}

// AnalyzeEmail runs Stage 1: Content analysis
func (c *Client) AnalyzeEmail(ctx context.Context, from, subject, body string, pastSlugs []string, customSystemPrompt string) (*EmailAnalysis, error) {
	systemPrompt := customSystemPrompt
	if systemPrompt == "" {
		// Default prompt if none provided
		systemPrompt = `You are an email classification assistant. Analyze the email and provide a JSON response with:
1. A snake_case_slug that categorizes this type of email (e.g., "marketing_newsletter", "invoice_due", "meeting_request")
2. An array of 3-5 keywords that describe the email content
3. A single line summary (max 100 chars)

Respond ONLY with valid JSON in this format:
{"slug": "example_slug", "keywords": ["word1", "word2", "word3"], "summary": "Brief summary here"}`
	}

	userPrompt := fmt.Sprintf(`From: %s
Subject: %s

Body:
%s

Past slugs used from this sender: %v

Analyze this email and provide the slug, keywords, and summary.`, from, subject, body, pastSlugs)

	c.logPrompts("AnalyzeEmail", systemPrompt, userPrompt)

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:        "email_analysis",
					Description: param.NewOpt("Email content analysis with slug, keywords, and summary"),
					Strict:      param.NewOpt(true),
					Schema: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"slug": map[string]interface{}{
								"type":        "string",
								"description": "A snake_case_slug categorizing the email type",
							},
							"keywords": map[string]interface{}{
								"type": "array",
								"items": map[string]interface{}{
									"type": "string",
								},
								"description": "3-5 keywords describing the email content",
							},
							"summary": map[string]interface{}{
								"type":        "string",
								"description": "Single line summary (max 100 chars)",
							},
						},
						"required":             []string{"slug", "keywords", "summary"},
						"additionalProperties": false,
					},
				},
			},
		},
		// Temperature:         openai.Float(0.3),
		MaxCompletionTokens: openai.Int(10000),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	choice := response.Choices[0]

	// Check for refusal
	if choice.Message.Refusal != "" {
		return nil, fmt.Errorf("openai refused request: %s", choice.Message.Refusal)
	}

	content := choice.Message.Content
	if content == "" {
		return nil, fmt.Errorf("empty content from openai (finish_reason: %s)", choice.FinishReason)
	}

	var analysis EmailAnalysis
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		return nil, fmt.Errorf("failed to parse openai response (content: %q): %w", content, err)
	}

	return &analysis, nil
}

// DetermineActions runs Stage 2: Action generation
// labelNames is the list of valid label names (for schema validation)
// formattedLabels is a human-readable bullet list with descriptions (for the prompt)
// memoryContext is the formatted memory string from past learnings
func (c *Client) DetermineActions(ctx context.Context, from, subject, slug string, keywords []string, summary string, labelNames []string, formattedLabels string, memoryContext string, customSystemPrompt string) (*EmailActions, error) {
	systemPrompt := customSystemPrompt
	if systemPrompt == "" {
		// Default prompt if none provided
		systemPrompt = `You are an email automation assistant. Based on the email analysis and past learnings, determine what actions to take and respond with JSON.

Available labels:
%s

Decide:
1. Which labels to apply (use exact label names from the list above, only when they clearly match)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decisions

Use the learnings from past email processing (provided below) to make better decisions about labeling and archiving.`
	}

	if customSystemPrompt == "" {
		// Default prompt has %s placeholder for labels
		systemPrompt = fmt.Sprintf(systemPrompt, formattedLabels)
	} else {
		// Always append labels to custom prompts so they're never lost
		systemPrompt += "\n\nAvailable labels:\n" + formattedLabels
	}

	userPrompt := fmt.Sprintf(`From: %s
Subject: %s
Slug: %s
Keywords: %v
Summary: %s

%sWhat actions should be taken for this email?`, from, subject, slug, keywords, summary, memoryContext)

	c.logPrompts("DetermineActions", systemPrompt, userPrompt)

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:        "email_actions",
					Description: param.NewOpt("Email automation actions including labels and inbox bypass"),
					Strict:      param.NewOpt(true),
					Schema: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"labels": map[string]interface{}{
								"type": "array",
								"items": map[string]interface{}{
									"type": "string",
								},
								"description": "Array of label names to apply",
							},
							"bypass_inbox": map[string]interface{}{
								"type":        "boolean",
								"description": "Whether to archive the email immediately",
							},
							"reasoning": map[string]interface{}{
								"type":        "string",
								"description": "Brief explanation of the decision",
							},
						},
						"required":             []string{"labels", "bypass_inbox", "reasoning"},
						"additionalProperties": false,
					},
				},
			},
		},
		// Temperature:         openai.Float(0.3),
		MaxCompletionTokens: openai.Int(10000),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	choice := response.Choices[0]

	// Check for refusal
	if choice.Message.Refusal != "" {
		return nil, fmt.Errorf("openai refused request: %s", choice.Message.Refusal)
	}

	content := choice.Message.Content
	if content == "" {
		return nil, fmt.Errorf("empty content from openai (finish_reason: %s)", choice.FinishReason)
	}

	var actions EmailActions
	if err := json.Unmarshal([]byte(content), &actions); err != nil {
		return nil, fmt.Errorf("failed to parse openai response (content: %q): %w", content, err)
	}

	return &actions, nil
}

// GenerateMemory creates a memory summary from email analysis
func (c *Client) GenerateMemory(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		// Temperature: openai.Float(0.5),
		MaxCompletionTokens: openai.Int(20000),
	})

	if err != nil {
		return "", fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return "", fmt.Errorf("no response from openai")
	}

	return response.Choices[0].Message.Content, nil
}
