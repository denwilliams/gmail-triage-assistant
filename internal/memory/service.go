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

// GenerateWeeklyMemory consolidates the past week's daily memories
func (s *Service) GenerateWeeklyMemory(ctx context.Context, userID int64) error {
	log.Printf("Generating weekly memory for user %d", userID)

	// Get last week's date range (last 7 days)
	now := time.Now()
	endDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	startDate := endDate.AddDate(0, 0, -7)

	// Get all daily memories from the past week
	memories, err := s.db.GetMemoriesByDateRange(ctx, userID, database.MemoryTypeDaily, startDate, endDate)
	if err != nil {
		return fmt.Errorf("failed to get daily memories: %w", err)
	}

	if len(memories) == 0 {
		log.Printf("No daily memories found for user %d in the past week, skipping weekly memory", userID)
		return nil
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeWeeklySummary); err == nil {
		customPrompt = prompt.Content
	}

	// Generate consolidated memory
	memoryContent, err := s.consolidateMemories(ctx, memories, "weekly", customPrompt)
	if err != nil {
		return fmt.Errorf("failed to consolidate memories: %w", err)
	}

	// Save weekly memory
	memory := &database.Memory{
		UserID:    userID,
		Type:      database.MemoryTypeWeekly,
		Content:   memoryContent,
		StartDate: startDate,
		EndDate:   endDate,
		CreatedAt: now,
	}

	if err := s.db.CreateMemory(ctx, memory); err != nil {
		return fmt.Errorf("failed to save weekly memory: %w", err)
	}

	log.Printf("✓ Weekly memory created for user %d (consolidated %d daily memories)", userID, len(memories))
	return nil
}

// GenerateMonthlyMemory consolidates the past month's weekly memories
func (s *Service) GenerateMonthlyMemory(ctx context.Context, userID int64) error {
	log.Printf("Generating monthly memory for user %d", userID)

	// Get last month's date range
	now := time.Now()
	endDate := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	startDate := endDate.AddDate(0, -1, 0)

	// Get all weekly memories from the past month
	memories, err := s.db.GetMemoriesByDateRange(ctx, userID, database.MemoryTypeWeekly, startDate, endDate)
	if err != nil {
		return fmt.Errorf("failed to get weekly memories: %w", err)
	}

	if len(memories) == 0 {
		log.Printf("No weekly memories found for user %d in the past month, skipping monthly memory", userID)
		return nil
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeMonthlySummary); err == nil {
		customPrompt = prompt.Content
	}

	// Generate consolidated memory
	memoryContent, err := s.consolidateMemories(ctx, memories, "monthly", customPrompt)
	if err != nil {
		return fmt.Errorf("failed to consolidate memories: %w", err)
	}

	// Save monthly memory
	memory := &database.Memory{
		UserID:    userID,
		Type:      database.MemoryTypeMonthly,
		Content:   memoryContent,
		StartDate: startDate,
		EndDate:   endDate,
		CreatedAt: now,
	}

	if err := s.db.CreateMemory(ctx, memory); err != nil {
		return fmt.Errorf("failed to save monthly memory: %w", err)
	}

	log.Printf("✓ Monthly memory created for user %d (consolidated %d weekly memories)", userID, len(memories))
	return nil
}

// GenerateYearlyMemory consolidates the past year's monthly memories
func (s *Service) GenerateYearlyMemory(ctx context.Context, userID int64) error {
	log.Printf("Generating yearly memory for user %d", userID)

	// Get last year's date range
	now := time.Now()
	endDate := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	startDate := endDate.AddDate(-1, 0, 0)

	// Get all monthly memories from the past year
	memories, err := s.db.GetMemoriesByDateRange(ctx, userID, database.MemoryTypeMonthly, startDate, endDate)
	if err != nil {
		return fmt.Errorf("failed to get monthly memories: %w", err)
	}

	if len(memories) == 0 {
		log.Printf("No monthly memories found for user %d in the past year, skipping yearly memory", userID)
		return nil
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeYearlySummary); err == nil {
		customPrompt = prompt.Content
	}

	// Generate consolidated memory
	memoryContent, err := s.consolidateMemories(ctx, memories, "yearly", customPrompt)
	if err != nil {
		return fmt.Errorf("failed to consolidate memories: %w", err)
	}

	// Save yearly memory
	memory := &database.Memory{
		UserID:    userID,
		Type:      database.MemoryTypeYearly,
		Content:   memoryContent,
		StartDate: startDate,
		EndDate:   endDate,
		CreatedAt: now,
	}

	if err := s.db.CreateMemory(ctx, memory); err != nil {
		return fmt.Errorf("failed to save yearly memory: %w", err)
	}

	log.Printf("✓ Yearly memory created for user %d (consolidated %d monthly memories)", userID, len(memories))
	return nil
}

// consolidateMemories uses AI to consolidate multiple memories into one higher-level memory
func (s *Service) consolidateMemories(ctx context.Context, memories []*database.Memory, period string, customPrompt string) (string, error) {
	systemPrompt := customPrompt
	if systemPrompt == "" {
		systemPrompt = fmt.Sprintf(`You are an AI assistant consolidating %s email processing insights. Review the provided memories and create a higher-level summary that:
1. Identifies overarching patterns and trends
2. Highlights important behavioral changes over time
3. Notes recurring themes across the period
4. Provides strategic insights for email management
5. Suggests any process improvements

Be concise and focus on the most significant patterns. Format as bullet points.`, period)
	}

	// Prepare summary of memories
	var memorySummaries []string
	for i, mem := range memories {
		memorySummaries = append(memorySummaries, fmt.Sprintf("Memory %d (%s to %s):\n%s",
			i+1,
			mem.StartDate.Format("2006-01-02"),
			mem.EndDate.Format("2006-01-02"),
			mem.Content,
		))
	}

	userPrompt := fmt.Sprintf(`Consolidate these %d memories from the past %s into a higher-level summary:

%s

Provide a concise %s summary with key patterns and strategic insights.`,
		len(memories), period, strings.Join(memorySummaries, "\n\n"), period)

	// Call AI to generate consolidated memory
	memory, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		return "", err
	}

	return memory, nil
}
