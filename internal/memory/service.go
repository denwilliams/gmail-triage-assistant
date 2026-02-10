package memory

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

// GenerateDailyMemory creates a memory from the previous day's email processing
func (s *Service) GenerateDailyMemory(ctx context.Context, userID int64) error {
	log.Printf("Generating daily memory for user %d", userID)

	// Get yesterday's date range
	now := time.Now()
	yesterday := now.AddDate(0, 0, -1)
	startOfYesterday := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 0, 0, 0, 0, yesterday.Location())
	endOfYesterday := startOfYesterday.Add(24 * time.Hour)

	// Get all emails processed yesterday
	emails, err := s.db.GetEmailsByDateRange(ctx, userID, startOfYesterday, endOfYesterday)
	if err != nil {
		return fmt.Errorf("failed to get emails: %w", err)
	}

	if len(emails) == 0 {
		// If no emails yesterday, try last 24 hours instead (useful for manual triggering)
		log.Printf("No emails processed yesterday for user %d, trying last 24 hours", userID)
		startOfYesterday = now.Add(-24 * time.Hour)
		endOfYesterday = now
		emails, err = s.db.GetEmailsByDateRange(ctx, userID, startOfYesterday, endOfYesterday)
		if err != nil {
			return fmt.Errorf("failed to get emails from last 24h: %w", err)
		}
		if len(emails) == 0 {
			log.Printf("No emails in last 24 hours for user %d, skipping memory generation", userID)
			return nil
		}
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeDailyReview); err == nil {
		customPrompt = prompt.Content
	}

	// Generate memory using AI
	memoryContent, err := s.generateMemoryFromEmails(ctx, emails, customPrompt)
	if err != nil {
		return fmt.Errorf("failed to generate memory: %w", err)
	}

	// Save memory to database
	memory := &database.Memory{
		UserID:    userID,
		Type:      database.MemoryTypeDaily,
		Content:   memoryContent,
		StartDate: startOfYesterday,
		EndDate:   endOfYesterday,
		CreatedAt: now,
	}

	if err := s.db.CreateMemory(ctx, memory); err != nil {
		return fmt.Errorf("failed to save memory: %w", err)
	}

	log.Printf("Successfully created daily memory for user %d (%d emails analyzed)", userID, len(emails))
	return nil
}

// generateMemoryFromEmails uses AI to analyze email patterns and generate insights
func (s *Service) generateMemoryFromEmails(ctx context.Context, emails []*database.Email, customPrompt string) (string, error) {
	systemPrompt := customPrompt
	if systemPrompt == "" {
		systemPrompt = `You are an AI assistant analyzing email processing patterns. Review the provided emails and generate insights about:
1. Common patterns in emails received (types of senders, subjects, content)
2. Which labels were most frequently applied and why
3. Whether emails were correctly categorized
4. Any sender patterns that should be remembered for future processing
5. Suggestions for improving categorization

Be concise and focus on actionable insights. Format as bullet points.`
	}

	// Prepare summary of emails
	var emailSummaries []string
	for i, email := range emails {
		if i >= 50 { // Limit to 50 emails to avoid token limits
			emailSummaries = append(emailSummaries, fmt.Sprintf("... and %d more emails", len(emails)-50))
			break
		}
		emailSummaries = append(emailSummaries, fmt.Sprintf(
			"- From: %s | Subject: %s | Slug: %s | Labels: %v | Archived: %v | Keywords: %v",
			email.FromAddress,
			email.Subject,
			email.Slug,
			email.LabelsApplied,
			email.BypassedInbox,
			email.Keywords,
		))
	}

	userPrompt := fmt.Sprintf(`Analyze these %d emails from yesterday and generate insights:

%s

Provide a concise memory summary with key patterns and insights.`, len(emails), strings.Join(emailSummaries, "\n"))

	// Call AI to generate memory
	memory, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		return "", err
	}

	return memory, nil
}
