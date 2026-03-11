package openai

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/packages/param"
	"github.com/openai/openai-go/shared"
)

// WizardOption represents a clickable option for a wizard question
type WizardOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// WizardQuestion represents a single question in the wizard flow
type WizardQuestion struct {
	ID      string         `json:"id"`
	Text    string         `json:"text"`
	Type    string         `json:"type"` // single_select, multi_select, text
	Options []WizardOption `json:"options"`
}

// WizardPrompts contains the generated system prompts
type WizardPrompts struct {
	EmailAnalyze string `json:"email_analyze"`
	EmailActions string `json:"email_actions"`
}

// WizardResponse is the structured AI output for wizard interactions
type WizardResponse struct {
	Done      bool             `json:"done"`
	Message   string           `json:"message"`
	Questions []WizardQuestion `json:"questions"`
	Prompts   WizardPrompts    `json:"prompts"`
}

// RunPromptWizard calls the AI with a wizard system/user prompt and returns structured output
func (c *Client) RunPromptWizard(ctx context.Context, systemPrompt, userPrompt string) (*WizardResponse, error) {
	c.logPrompts("RunPromptWizard", systemPrompt, userPrompt)

	response, err := c.client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: shared.ChatModel(c.model),
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage(systemPrompt),
			openai.UserMessage(userPrompt),
		},
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{
			OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
				JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{
					Name:        "wizard_response",
					Description: param.NewOpt("Prompt setup wizard response with questions or final prompts"),
					Strict:      param.NewOpt(true),
					Schema: map[string]interface{}{
						"type": "object",
						"properties": map[string]interface{}{
							"done": map[string]interface{}{
								"type":        "boolean",
								"description": "True when all questions are answered and prompts are generated",
							},
							"message": map[string]interface{}{
								"type":        "string",
								"description": "A brief message to the user explaining the current step",
							},
							"questions": map[string]interface{}{
								"type": "array",
								"items": map[string]interface{}{
									"type": "object",
									"properties": map[string]interface{}{
										"id": map[string]interface{}{
											"type":        "string",
											"description": "Unique question identifier",
										},
										"text": map[string]interface{}{
											"type":        "string",
											"description": "The question text to display",
										},
										"type": map[string]interface{}{
											"type":        "string",
											"description": "Question type: single_select, multi_select, or text",
										},
										"options": map[string]interface{}{
											"type": "array",
											"items": map[string]interface{}{
												"type": "object",
												"properties": map[string]interface{}{
													"value": map[string]interface{}{
														"type":        "string",
														"description": "Option value",
													},
													"label": map[string]interface{}{
														"type":        "string",
														"description": "Display label",
													},
												},
												"required":             []string{"value", "label"},
												"additionalProperties": false,
											},
											"description": "Available options (empty for text type)",
										},
									},
									"required":             []string{"id", "text", "type", "options"},
									"additionalProperties": false,
								},
								"description": "Questions to ask the user (empty when done=true)",
							},
							"prompts": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"email_analyze": map[string]interface{}{
										"type":        "string",
										"description": "Generated system prompt for email analysis stage",
									},
									"email_actions": map[string]interface{}{
										"type":        "string",
										"description": "Generated system prompt for email actions stage",
									},
								},
								"required":             []string{"email_analyze", "email_actions"},
								"additionalProperties": false,
							},
						},
						"required":             []string{"done", "message", "questions", "prompts"},
						"additionalProperties": false,
					},
				},
			},
		},
		MaxCompletionTokens: openai.Int(16000),
	})

	if err != nil {
		return nil, fmt.Errorf("openai api error: %w", err)
	}

	if len(response.Choices) == 0 {
		return nil, fmt.Errorf("no response from openai")
	}

	choice := response.Choices[0]

	if choice.Message.Refusal != "" {
		return nil, fmt.Errorf("openai refused request: %s", choice.Message.Refusal)
	}

	content := choice.Message.Content
	if content == "" {
		return nil, fmt.Errorf("empty content from openai (finish_reason: %s)", choice.FinishReason)
	}

	var result WizardResponse
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse wizard response (content: %q): %w", content, err)
	}

	return &result, nil
}
