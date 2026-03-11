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
	"github.com/den/gmail-triage-assistant/internal/pushover"
	"github.com/den/gmail-triage-assistant/internal/webhook"
	"golang.org/x/oauth2"
)

type Processor struct {
	db          *database.DB
	openai      *openai.Client
	oauthConfig *oauth2.Config
	pushover    *pushover.Client
	webhook     *webhook.Client
}

func NewProcessor(db *database.DB, openaiClient *openai.Client, oauthConfig *oauth2.Config, pushoverClient *pushover.Client, webhookClient *webhook.Client) *Processor {
	return &Processor{
		db:          db,
		openai:      openaiClient,
		oauthConfig: oauthConfig,
		pushover:    pushoverClient,
		webhook:     webhookClient,
	}
}

// ProcessEmail runs the full two-stage AI pipeline on an email
func (p *Processor) ProcessEmail(ctx context.Context, user *database.User, message *gmail.Message) error {
	log.Printf("[%s] Processing email: %s - %s", user.Email, message.From, message.Subject)

	// Skip if already processed (prevents duplicate notifications on retry)
	exists, err := p.db.EmailExists(ctx, message.ID)
	if err != nil {
		log.Printf("[%s] Warning: failed to check if email exists: %v", user.Email, err)
	} else if exists {
		log.Printf("[%s] Skipping already processed email: %s", user.Email, message.ID)
		return nil
	}

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

	// Append AI-generated prompt supplements (if any exist)
	if aiPrompt, err := p.db.GetLatestAIPrompt(ctx, user.ID, database.AIPromptTypeEmailAnalyze); err == nil && aiPrompt != nil {
		if analyzePrompt != "" {
			analyzePrompt += "\n\n" + aiPrompt.Content
		} else {
			analyzePrompt = aiPrompt.Content
		}
	}
	if aiPrompt, err := p.db.GetLatestAIPrompt(ctx, user.ID, database.AIPromptTypeEmailActions); err == nil && aiPrompt != nil {
		if actionsPrompt != "" {
			actionsPrompt += "\n\n" + aiPrompt.Content
		} else {
			actionsPrompt = aiPrompt.Content
		}
	}

	// Get recent memories to provide context (1 yearly, 1 monthly, 1 weekly, up to 7 daily)
	memoryContext := ""
	allMemories, err := p.db.GetRecentMemoriesForContext(ctx, user.ID)
	if err == nil && len(allMemories) > 0 {
		memoryContext = "Past learnings from email processing:\n\n"
		for _, mem := range allMemories {
			memoryContext += fmt.Sprintf("**%s Memory:**\n%s\n\n", strings.ToUpper(string(mem.Type)), mem.Content)
		}
	}

	// Load or bootstrap sender and domain profiles
	domain := database.ExtractDomain(message.From)
	senderProfile := p.loadOrBootstrapProfile(ctx, user.ID, database.ProfileTypeSender, message.From, domain)
	var domainProfile *database.SenderProfile
	if !database.IsIgnoredDomain(domain) {
		domainProfile = p.loadOrBootstrapProfile(ctx, user.ID, database.ProfileTypeDomain, domain, domain)
	}
	senderContext := p.formatProfilesForPrompt(senderProfile, domainProfile)

	// Stage 1: Analyze email content
	analysis, err := p.openai.AnalyzeEmail(ctx, message.From, message.Subject, body, senderContext, analyzePrompt)
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
	actions, err := p.openai.DetermineActions(ctx, message.From, message.Subject, analysis.Slug, analysis.Keywords, analysis.Summary, labelNames, formattedLabels, senderContext, memoryContext, actionsPrompt)
	if err != nil {
		return fmt.Errorf("stage 2 failed: %w", err)
	}

	log.Printf("[%s] Stage 2 - Labels: %v, Bypass: %v, Reason: %s", user.Email, actions.Labels, actions.BypassInbox, actions.Reasoning)

	// Send push notification if AI provided a notification message and user has Pushover configured
	notificationSent := false
	if actions.NotificationMessage != "" && user.HasPushoverConfig() {
		if err := p.pushover.Send(user.PushoverUserKey, user.PushoverAppToken, message.Subject, actions.NotificationMessage); err != nil {
			log.Printf("[%s] Failed to send push notification: %v", user.Email, err)
		} else {
			notificationSent = true
			log.Printf("[%s] Push notification sent for: %s", user.Email, message.Subject)

			// Persist notification to database (non-critical)
			notif := &database.Notification{
				UserID:      user.ID,
				EmailID:     message.ID,
				FromAddress: message.From,
				Subject:     message.Subject,
				Message:     actions.NotificationMessage,
				SentAt:      time.Now(),
			}
			if err := p.db.CreateNotification(ctx, notif); err != nil {
				log.Printf("[%s] Failed to save notification: %v", user.Email, err)
			}
		}
	}

	// Send webhook notification if AI provided a notification message and user has webhook configured
	if actions.NotificationMessage != "" && user.HasWebhookConfig() {
		payload := webhook.Payload{
			Title:         message.Subject,
			Message:       actions.NotificationMessage,
			FromAddress:   message.From,
			EmailID:       message.ID,
			Slug:          analysis.Slug,
			Subject:       message.Subject,
			LabelsApplied: actions.Labels,
			ProcessedAt:   time.Now().UTC().Format(time.RFC3339),
		}
		if err := p.webhook.Send(user.WebhookURL, user.WebhookHeaderKey, user.WebhookHeaderValue, payload); err != nil {
			log.Printf("[%s] Failed to send webhook notification: %v", user.Email, err)
		} else {
			notificationSent = true
			log.Printf("[%s] Webhook notification sent for: %s", user.Email, message.Subject)
		}
	}

	// Save to database
	email := &database.Email{
		ID:               message.ID,
		UserID:           user.ID,
		FromAddress:      message.From,
		FromDomain:       domain,
		Subject:          message.Subject,
		Slug:             analysis.Slug,
		Keywords:         analysis.Keywords,
		Summary:          analysis.Summary,
		LabelsApplied:    actions.Labels,
		BypassedInbox:    actions.BypassInbox,
		Reasoning:        actions.Reasoning,
		NotificationSent: notificationSent,
		ProcessedAt:      time.Now(),
		CreatedAt:        time.Now(),
	}

	if err := p.db.CreateEmail(ctx, email); err != nil {
		return fmt.Errorf("failed to save email to database: %w", err)
	}

	// Apply actions to Gmail
	if err := p.applyActionsToGmail(ctx, user, message.ID, actions); err != nil {
		log.Printf("Error applying actions to Gmail: %v", err)
		// Don't return error - email is already processed and saved
	}

	// Update sender profiles (non-critical)
	if senderProfile != nil {
		if err := p.updateProfileAfterProcessing(ctx, senderProfile, analysis, actions); err != nil {
			log.Printf("[%s] Error updating sender profile: %v", user.Email, err)
		}
	}
	if domainProfile != nil {
		if err := p.updateProfileAfterProcessing(ctx, domainProfile, analysis, actions); err != nil {
			log.Printf("[%s] Error updating domain profile: %v", user.Email, err)
		}
	}

	log.Printf("[%s] ✓ Email processed successfully: %s", user.Email, message.Subject)
	return nil
}

// loadOrBootstrapProfile fetches an existing profile or creates one from history
func (p *Processor) loadOrBootstrapProfile(ctx context.Context, userID int64, profileType database.ProfileType, identifier string, domain string) *database.SenderProfile {
	profile, err := p.db.GetSenderProfile(ctx, userID, profileType, identifier)
	if err != nil {
		log.Printf("Error loading %s profile for %s: %v", profileType, identifier, err)
		return nil
	}
	if profile != nil {
		return profile
	}
	return p.bootstrapProfile(ctx, userID, profileType, identifier, domain)
}

// bootstrapProfile creates a new profile from historical emails
func (p *Processor) bootstrapProfile(ctx context.Context, userID int64, profileType database.ProfileType, identifier string, domain string) *database.SenderProfile {
	var emails []*database.Email
	var err error

	if profileType == database.ProfileTypeSender {
		emails, err = p.db.GetHistoricalEmailsFromAddress(ctx, userID, identifier, 25)
	} else {
		emails, err = p.db.GetHistoricalEmailsFromDomain(ctx, userID, identifier, 25)
	}
	if err != nil {
		log.Printf("Error getting historical emails for %s profile %s: %v", profileType, identifier, err)
		return nil
	}

	// Build profile from historical data
	profile := database.BuildProfileFromEmails(userID, profileType, identifier, emails)

	// If we have history, use AI to classify and summarize
	if len(emails) > 0 {
		result, err := p.openai.BootstrapSenderProfile(ctx, identifier, emails)
		if err != nil {
			log.Printf("Error bootstrapping %s profile for %s: %v", profileType, identifier, err)
		} else {
			profile.SenderType = result.SenderType
			profile.Summary = result.Summary
		}
	}

	// Save the profile
	if err := p.db.UpsertSenderProfile(ctx, profile); err != nil {
		log.Printf("Error saving bootstrapped %s profile for %s: %v", profileType, identifier, err)
		return nil
	}

	log.Printf("Bootstrapped %s profile for %s (emails: %d)", profileType, identifier, len(emails))
	return profile
}

// updateProfileAfterProcessing increments counters and evolves summary
func (p *Processor) updateProfileAfterProcessing(ctx context.Context, profile *database.SenderProfile, analysis *openai.EmailAnalysis, actions *openai.EmailActions) error {
	profile.EmailCount++
	profile.LastSeenAt = time.Now()

	if analysis.Slug != "" {
		if profile.SlugCounts == nil {
			profile.SlugCounts = make(map[string]int)
		}
		profile.SlugCounts[analysis.Slug]++
	}
	for _, label := range actions.Labels {
		if profile.LabelCounts == nil {
			profile.LabelCounts = make(map[string]int)
		}
		profile.LabelCounts[label]++
	}
	for _, kw := range analysis.Keywords {
		if profile.KeywordCounts == nil {
			profile.KeywordCounts = make(map[string]int)
		}
		profile.KeywordCounts[kw]++
	}
	if actions.BypassInbox {
		profile.EmailsArchived++
	}
	if actions.NotificationMessage != "" {
		profile.EmailsNotified++
	}

	// Evolve summary via AI
	update := &openai.ProfileUpdateContext{
		From:     profile.Identifier,
		Subject:  analysis.Summary,
		Slug:     analysis.Slug,
		Keywords: analysis.Keywords,
		Labels:   actions.Labels,
		Archived: actions.BypassInbox,
		Notified: actions.NotificationMessage != "",
		Summary:  analysis.Summary,
	}
	result, err := p.openai.EvolveProfileSummary(ctx, profile.Summary, profile.SenderType, update)
	if err != nil {
		log.Printf("Error evolving %s profile summary for %s: %v", profile.ProfileType, profile.Identifier, err)
	} else {
		profile.SenderType = result.SenderType
		profile.Summary = result.Summary
	}

	return p.db.UpsertSenderProfile(ctx, profile)
}

// formatProfilesForPrompt creates the sender context string for AI prompts
func (p *Processor) formatProfilesForPrompt(sender *database.SenderProfile, domain *database.SenderProfile) string {
	if sender == nil && domain == nil {
		return ""
	}

	var b strings.Builder
	if sender != nil && sender.EmailCount > 0 {
		fmt.Fprintf(&b, "**Sender Profile** (%s):\n%s\n", sender.Identifier, sender.FormatForPrompt())
	}
	if domain != nil && domain.EmailCount > 0 {
		fmt.Fprintf(&b, "**Domain Profile** (%s):\n%s\n", domain.Identifier, domain.FormatForPrompt())
	}
	return b.String()
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
