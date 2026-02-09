package openai

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"github.com/openai/openai-go/shared"
)

type Client struct {
	client openai.Client
	model  string
}

// NewClient creates a new OpenAI client
func NewClient(apiKey, model, baseURL string) *Client {
	client := openai.NewClient(option.WithAPIKey(apiKey))
	return &Client{
		client: client,
		model:  model,
	}
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
		systemPrompt = `You are an email classification assistant. Analyze the email and provide:
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

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		// Temperature:         openai.Float(0.3),
		MaxCompletionTokens: openai.Int(5000),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	content := response.Choices[0].Message.Content

	var analysis EmailAnalysis
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		return nil, fmt.Errorf("failed to parse openai response: %w", err)
	}

	return &analysis, nil
}

// DetermineActions runs Stage 2: Action generation
func (c *Client) DetermineActions(ctx context.Context, slug string, keywords []string, summary string, availableLabels []string, customSystemPrompt string) (*EmailActions, error) {
	systemPrompt := customSystemPrompt
	if systemPrompt == "" {
		// Default prompt if none provided
		systemPrompt = `You are an email automation assistant. Based on the email analysis, determine what actions to take.

Available labels: %v

Decide:
1. Which labels to apply (array of label names from available labels)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decisions

Respond ONLY with valid JSON in this format:
{"labels": ["label1", "label2"], "bypass_inbox": false, "reasoning": "Brief explanation"}`
	}

	systemPrompt = fmt.Sprintf(systemPrompt, availableLabels)

	userPrompt := fmt.Sprintf(`Slug: %s
Keywords: %v
Summary: %s

What actions should be taken for this email?`, slug, keywords, summary)

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		// Temperature:         openai.Float(0.3),
		MaxCompletionTokens: openai.Int(1000),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	content := response.Choices[0].Message.Content

	var actions EmailActions
	if err := json.Unmarshal([]byte(content), &actions); err != nil {
		return nil, fmt.Errorf("failed to parse openai response: %w", err)
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
		MaxTokens: openai.Int(2000),
	})

	if err != nil {
		return "", fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return "", fmt.Errorf("no response from openai")
	}

	return response.Choices[0].Message.Content, nil
}
