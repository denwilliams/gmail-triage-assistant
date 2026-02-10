package wrapup

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/openai"
)

type Service struct {
	db     *database.DB
	openai *openai.Client
}

func NewService(db *database.DB, openaiClient *openai.Client) *Service {
	return &Service{
		db:     db,
		openai: openaiClient,
	}
}

// GenerateMorningWrapup creates a summary of emails processed overnight (since last evening)
func (s *Service) GenerateMorningWrapup(ctx context.Context, userID int64) error {
	log.Printf("Generating morning wrapup for user %d", userID)

	now := time.Now()
	// Get emails since 5PM yesterday
	yesterday := now.AddDate(0, 0, -1)
	since := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 17, 0, 0, 0, yesterday.Location())

	emails, err := s.db.GetEmailsByDateRange(ctx, userID, since, now)
	if err != nil {
		return fmt.Errorf("failed to get emails: %w", err)
	}

	if len(emails) == 0 {
		log.Printf("No emails since yesterday evening for user %d, skipping morning wrapup", userID)
		return nil
	}

	content, err := s.generateWrapupContent(ctx, emails, "morning")
	if err != nil {
		return fmt.Errorf("failed to generate wrapup: %w", err)
	}

	report := &database.WrapupReport{
		UserID:      userID,
		ReportType:  "morning",
		Content:     content,
		EmailCount:  len(emails),
		GeneratedAt: now,
	}

	if err := s.db.CreateWrapupReport(ctx, report); err != nil {
		return fmt.Errorf("failed to save wrapup: %w", err)
	}

	log.Printf("✓ Morning wrapup created for user %d (%d emails)", userID, len(emails))
	return nil
}

// GenerateEveningWrapup creates a summary of emails processed during the day
func (s *Service) GenerateEveningWrapup(ctx context.Context, userID int64) error {
	log.Printf("Generating evening wrapup for user %d", userID)

	now := time.Now()
	// Get emails since 8AM today
	today := time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, now.Location())

	emails, err := s.db.GetEmailsByDateRange(ctx, userID, today, now)
	if err != nil {
		return fmt.Errorf("failed to get emails: %w", err)
	}

	if len(emails) == 0 {
		log.Printf("No emails since this morning for user %d, skipping evening wrapup", userID)
		return nil
	}

	content, err := s.generateWrapupContent(ctx, emails, "evening")
	if err != nil {
		return fmt.Errorf("failed to generate wrapup: %w", err)
	}

	report := &database.WrapupReport{
		UserID:      userID,
		ReportType:  "evening",
		Content:     content,
		EmailCount:  len(emails),
		GeneratedAt: now,
	}

	if err := s.db.CreateWrapupReport(ctx, report); err != nil {
		return fmt.Errorf("failed to save wrapup: %w", err)
	}

	log.Printf("✓ Evening wrapup created for user %d (%d emails)", userID, len(emails))
	return nil
}

func (s *Service) generateWrapupContent(ctx context.Context, emails []*database.Email, reportType string) (string, error) {
	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, emails[0].UserID, database.PromptTypeWrapUpReport); err == nil {
		customPrompt = prompt.Content
	}

	systemPrompt := customPrompt
	if systemPrompt == "" {
		systemPrompt = `You are an AI assistant creating an email processing summary report. Review the emails and provide a concise wrapup including:
1. Total number of emails processed
2. Most common senders and types
3. Most interesting or important emails (based on subject and sender) and why
4. Labels applied summary
5. Any notable patterns or important emails
6. Quick overview of what was archived vs kept in inbox

Keep it brief and actionable - this is a daily digest for quick review.`
	}

	// Prepare summary of emails (limit to 100)
	var emailSummaries []string
	for i, email := range emails {
		if i >= 100 {
			emailSummaries = append(emailSummaries, fmt.Sprintf("... and %d more emails", len(emails)-100))
			break
		}
		archived := ""
		if email.BypassedInbox {
			archived = " [ARCHIVED]"
		}
		emailSummaries = append(emailSummaries, fmt.Sprintf(
			"- %s: %s | Labels: %v%s",
			email.FromAddress,
			email.Subject,
			email.LabelsApplied,
			archived,
		))
	}

	timeframe := "overnight"
	if reportType == "evening" {
		timeframe = "today"
	}

	userPrompt := fmt.Sprintf(`Create a %s wrapup report for these %d emails processed %s:

%s

Provide a brief, scannable summary.`, reportType, len(emails), timeframe, strings.Join(emailSummaries, "\n"))

	content, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		return "", err
	}

	return content, nil
}
