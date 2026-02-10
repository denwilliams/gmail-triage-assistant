package pipeline

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/gmail"
	"github.com/den/gmail-triage-assistant/internal/openai"
	"golang.org/x/oauth2"
)

type Processor struct {
	db          *database.DB
	openai      *openai.Client
	oauthConfig *oauth2.Config
}

func NewProcessor(db *database.DB, openaiClient *openai.Client, oauthConfig *oauth2.Config) *Processor {
	return &Processor{
		db:          db,
		openai:      openaiClient,
		oauthConfig: oauthConfig,
	}
}

// ProcessEmail runs the full two-stage AI pipeline on an email
func (p *Processor) ProcessEmail(ctx context.Context, user *database.User, message *gmail.Message) error {
	log.Printf("[%s] Processing email: %s - %s", user.Email, message.From, message.Subject)

	// Decode body if it's base64 encoded
	body := message.Body
	if body != "" {
		decoded, err := base64.URLEncoding.DecodeString(body)
		if err == nil {
			body = string(decoded)
		}
	}

	// Truncate body for AI processing (to save tokens)
	if len(body) > 2000 {
		body = body[:2000] + "..."
	}

	// Get custom system prompts
	analyzePrompt := ""
	actionsPrompt := ""
	if prompt, err := p.db.GetSystemPrompt(ctx, user.ID, database.PromptTypeEmailAnalyze); err == nil {
		analyzePrompt = prompt.Content
	}
	if prompt, err := p.db.GetSystemPrompt(ctx, user.ID, database.PromptTypeEmailActions); err == nil {
		actionsPrompt = prompt.Content
	}

	// Get recent memories to provide context (1 yearly, 1 monthly, 1 weekly, up to 7 daily)
	allMemories, err := p.db.GetRecentMemoriesForContext(ctx, user.ID)
	if err == nil && len(allMemories) > 0 {
		memoryContext := "\n\nInsights from past email processing:\n"
		for _, mem := range allMemories {
			memoryContext += fmt.Sprintf("- [%s] %s\n", mem.Type, mem.Content)
		}

		// Append memory context to prompts
		if analyzePrompt != "" {
			analyzePrompt += memoryContext
		}
		if actionsPrompt != "" {
			actionsPrompt += memoryContext
		}
	}

	// Stage 1: Get past slugs from this sender for reuse
	pastSlugs, err := p.db.GetPastSlugsFromSender(ctx, user.ID, message.From, 5)
	if err != nil {
		log.Printf("Error getting past slugs: %v", err)
		pastSlugs = []string{}
	}

	// Stage 1: Analyze email content
	analysis, err := p.openai.AnalyzeEmail(ctx, message.From, message.Subject, body, pastSlugs, analyzePrompt)
	if err != nil {
		return fmt.Errorf("stage 1 failed: %w", err)
	}

	log.Printf("[%s] Stage 1 - Slug: %s, Keywords: %v", user.Email, analysis.Slug, analysis.Keywords)

	// Stage 2: Get user's available labels with descriptions
	labelDetails, err := p.db.GetUserLabelsWithDetails(ctx, user.ID)
	if err != nil {
		log.Printf("Error getting user labels: %v", err)
		labelDetails = nil
	}

	// Format labels as bullet points with quoted names and descriptions
	var labelNames []string
	var labelLines []string
	for _, l := range labelDetails {
		labelNames = append(labelNames, l.Name)
		line := fmt.Sprintf(`- "%s"`, l.Name)
		if l.Description != "" {
			line += ": " + l.Description
		}
		if len(l.Reasons) > 0 {
			line += " (e.g. " + strings.Join(l.Reasons, ", ") + ")"
		}
		labelLines = append(labelLines, line)
	}
	formattedLabels := strings.Join(labelLines, "\n")

	// Stage 2: Determine actions
	actions, err := p.openai.DetermineActions(ctx, message.From, message.Subject, analysis.Slug, analysis.Keywords, analysis.Summary, labelNames, formattedLabels, actionsPrompt)
	if err != nil {
		return fmt.Errorf("stage 2 failed: %w", err)
	}

	log.Printf("[%s] Stage 2 - Labels: %v, Bypass: %v, Reason: %s", user.Email, actions.Labels, actions.BypassInbox, actions.Reasoning)

	// Save to database
	email := &database.Email{
		ID:            message.ID,
		UserID:        user.ID,
		FromAddress:   message.From,
		Subject:       message.Subject,
		Slug:          analysis.Slug,
		Keywords:      analysis.Keywords,
		Summary:       analysis.Summary,
		LabelsApplied: actions.Labels,
		BypassedInbox: actions.BypassInbox,
		Reasoning:     actions.Reasoning,
		ProcessedAt:   time.Now(),
		CreatedAt:     time.Now(),
	}

	if err := p.db.CreateEmail(ctx, email); err != nil {
		return fmt.Errorf("failed to save email to database: %w", err)
	}

	// Apply actions to Gmail
	if err := p.applyActionsToGmail(ctx, user, message.ID, actions); err != nil {
		log.Printf("Error applying actions to Gmail: %v", err)
		// Don't return error - email is already processed and saved
	}

	log.Printf("[%s] ✓ Email processed successfully: %s", user.Email, message.Subject)
	return nil
}

// applyActionsToGmail applies labels and inbox bypass to the actual Gmail message
func (p *Processor) applyActionsToGmail(ctx context.Context, user *database.User, messageID string, actions *openai.EmailActions) error {
	// Create Gmail client for this user
	token := user.GetOAuth2Token()
	client, err := gmail.NewClient(ctx, p.oauthConfig, token)
	if err != nil {
		return fmt.Errorf("failed to create gmail client: %w", err)
	}

	// Apply labels
	if len(actions.Labels) > 0 {
		labelIDs := make([]string, 0, len(actions.Labels))

		for _, labelName := range actions.Labels {
			// Try to get existing label ID
			labelID, err := client.GetLabelID(ctx, labelName)
			if err != nil {
				// Label doesn't exist, create it
				log.Printf("[%s] Creating new label: %s", user.Email, labelName)
				newLabel, createErr := client.CreateLabel(ctx, labelName)
				if createErr != nil {
					log.Printf("[%s] Failed to create label %s: %v", user.Email, labelName, createErr)
					continue
				}
				labelID = newLabel.Id
				log.Printf("[%s] Created label %s with ID %s", user.Email, labelName, labelID)
			}

			labelIDs = append(labelIDs, labelID)
		}

		// Apply all labels to the message
		if len(labelIDs) > 0 {
			if err := client.AddLabels(ctx, messageID, labelIDs); err != nil {
				return fmt.Errorf("failed to add labels: %w", err)
			}
			log.Printf("[%s] Applied labels %v to message %s", user.Email, actions.Labels, messageID)
		}
	}

	// Bypass inbox (archive)
	if actions.BypassInbox {
		if err := client.ArchiveMessage(ctx, messageID); err != nil {
			return fmt.Errorf("failed to archive message: %w", err)
		}
		log.Printf("[%s] Archived message %s", user.Email, messageID)
	}

	return nil
}
