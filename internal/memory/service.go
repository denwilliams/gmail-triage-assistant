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

	// Get available labels so AI knows what labels actually exist
	labelDetails, err := s.db.GetUserLabelsWithDetails(ctx, userID)
	if err != nil {
		log.Printf("Warning: failed to get user labels for memory generation: %v", err)
		labelDetails = nil
	}

	// Generate memory using AI
	memoryContent, err := s.generateMemoryFromEmails(ctx, emails, labelDetails, customPrompt)
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
func (s *Service) generateMemoryFromEmails(ctx context.Context, emails []*database.Email, labelDetails []*database.Label, customPrompt string) (string, error) {
	// Build available labels section
	labelsSection := ""
	if len(labelDetails) > 0 {
		var labelLines []string
		for _, label := range labelDetails {
			line := fmt.Sprintf("- %s", label.Name)
			if label.Description != "" {
				line += fmt.Sprintf(": %s", label.Description)
			}
			labelLines = append(labelLines, line)
		}
		labelsSection = fmt.Sprintf("\n\nAvailable labels (ONLY reference these exact label names in your learnings):\n%s", strings.Join(labelLines, "\n"))
	}

	systemPrompt := customPrompt
	if systemPrompt == "" {
		systemPrompt = `You are an AI assistant creating learnings to improve future email processing decisions. Your goal is NOT to summarize what happened, but to extract insights that will help process emails better tomorrow.

Analyze the emails and their categorizations, then create a memory focused on:

**Key learnings for tomorrow:**
- Specific rules to apply (e.g., "emails from @company.com with 'invoice' should get Urgent label")
- Sender patterns to remember
- Content patterns that indicate specific labels

**What worked well:**
- Categorization decisions that seem correct and should be repeated
- Patterns successfully identified (e.g., "newsletters from X always get archived")
- Sender behaviors correctly recognized

**What to improve:**
- Emails that may have been miscategorized and why
- Patterns that were missed or incorrectly applied
- Better ways to handle similar emails in the future

IMPORTANT: Keep your response CONCISE - aim for around 100 words maximum. Be specific and actionable. Focus only on the most important insights that will directly improve future email processing. Format as concise bullet points.`
	}

	if labelsSection != "" {
		systemPrompt += labelsSection
	}

	// Prepare summary of emails and collect human feedback separately
	var emailSummaries []string
	var humanFeedbackItems []string

	for i, email := range emails {
		if i >= 50 { // Limit to 50 emails to avoid token limits
			emailSummaries = append(emailSummaries, fmt.Sprintf("... and %d more emails", len(emails)-50))
			break
		}

		// Include reasoning in the summary so AI can learn from past decisions
		reasoning := ""
		if email.Reasoning != "" {
			reasoning = fmt.Sprintf(" | AI Reasoning: %s", email.Reasoning)
		}

		emailSummaries = append(emailSummaries, fmt.Sprintf(
			"- From: %s | Subject: %s | Slug: %s | Labels: %v | Archived: %v | Keywords: %v%s",
			email.FromAddress,
			email.Subject,
			email.Slug,
			email.LabelsApplied,
			email.BypassedInbox,
			email.Keywords,
			reasoning,
		))

		// Collect human feedback separately for emphasis
		if email.HumanFeedback != "" {
			humanFeedbackItems = append(humanFeedbackItems, fmt.Sprintf(
				"- Email from %s (Subject: %s): %s",
				email.FromAddress,
				email.Subject,
				email.HumanFeedback,
			))
		}
	}

	humanFeedbackSection := ""
	if len(humanFeedbackItems) > 0 {
		humanFeedbackSection = fmt.Sprintf(`

**IMPORTANT - HUMAN FEEDBACK (PRIORITIZE THESE):**
The human provided explicit feedback on these emails. These instructions are CRITICAL and must be prominently included in your memory:

%s

These human corrections should be given highest priority in your learnings.

`, strings.Join(humanFeedbackItems, "\n"))
	}

	userPrompt := fmt.Sprintf(`Review these %d processed emails and extract learnings to improve future email handling:

%s
%s
Focus on creating actionable insights that will help process similar emails better in the future. What patterns should be reinforced? What should be done differently?`, len(emails), strings.Join(emailSummaries, "\n"), humanFeedbackSection)

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

	// Get the most recent weekly memory (to evolve from)
	previousWeeklyMemories, err := s.db.GetMemoriesByType(ctx, userID, database.MemoryTypeWeekly, 1)
	if err != nil {
		return fmt.Errorf("failed to get previous weekly memory: %w", err)
	}

	var previousMemory *database.Memory
	if len(previousWeeklyMemories) > 0 {
		previousMemory = previousWeeklyMemories[0]
		log.Printf("Found previous weekly memory from %s, will evolve it", previousMemory.StartDate.Format("2006-01-02"))
	} else {
		log.Printf("No previous weekly memory found, will create first one")
	}

	// Get all daily memories since the last weekly memory (or last 7 days if no previous)
	var dailyStartDate time.Time
	if previousMemory != nil {
		// Get daily memories since the last weekly memory ended
		dailyStartDate = previousMemory.EndDate
	} else {
		dailyStartDate = startDate
	}

	dailyMemories, err := s.db.GetMemoriesByDateRange(ctx, userID, database.MemoryTypeDaily, dailyStartDate, endDate)
	if err != nil {
		return fmt.Errorf("failed to get daily memories: %w", err)
	}

	if len(dailyMemories) == 0 {
		log.Printf("No new daily memories found for user %d since %s, skipping weekly memory", userID, dailyStartDate.Format("2006-01-02"))
		return nil
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeWeeklySummary); err == nil {
		customPrompt = prompt.Content
	}

	// Generate consolidated memory (evolving from previous if exists)
	memoryContent, err := s.consolidateMemories(ctx, previousMemory, dailyMemories, "weekly", customPrompt)
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

	if previousMemory != nil {
		log.Printf("✓ Weekly memory evolved for user %d (incorporated %d new daily memories)", userID, len(dailyMemories))
	} else {
		log.Printf("✓ Weekly memory created for user %d (consolidated %d daily memories)", userID, len(dailyMemories))
	}
	return nil
}

// GenerateMonthlyMemory consolidates the past month's weekly memories
func (s *Service) GenerateMonthlyMemory(ctx context.Context, userID int64) error {
	log.Printf("Generating monthly memory for user %d", userID)

	// Get last month's date range
	now := time.Now()
	endDate := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	startDate := endDate.AddDate(0, -1, 0)

	// Get the most recent monthly memory (to evolve from)
	previousMonthlyMemories, err := s.db.GetMemoriesByType(ctx, userID, database.MemoryTypeMonthly, 1)
	if err != nil {
		return fmt.Errorf("failed to get previous monthly memory: %w", err)
	}

	var previousMemory *database.Memory
	if len(previousMonthlyMemories) > 0 {
		previousMemory = previousMonthlyMemories[0]
		log.Printf("Found previous monthly memory from %s, will evolve it", previousMemory.StartDate.Format("2006-01-02"))
	} else {
		log.Printf("No previous monthly memory found, will create first one")
	}

	// Get all weekly memories since the last monthly memory (or last month if no previous)
	var weeklyStartDate time.Time
	if previousMemory != nil {
		weeklyStartDate = previousMemory.EndDate
	} else {
		weeklyStartDate = startDate
	}

	weeklyMemories, err := s.db.GetMemoriesByDateRange(ctx, userID, database.MemoryTypeWeekly, weeklyStartDate, endDate)
	if err != nil {
		return fmt.Errorf("failed to get weekly memories: %w", err)
	}

	if len(weeklyMemories) == 0 {
		log.Printf("No new weekly memories found for user %d since %s, skipping monthly memory", userID, weeklyStartDate.Format("2006-01-02"))
		return nil
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeMonthlySummary); err == nil {
		customPrompt = prompt.Content
	}

	// Generate consolidated memory (evolving from previous if exists)
	memoryContent, err := s.consolidateMemories(ctx, previousMemory, weeklyMemories, "monthly", customPrompt)
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

	if previousMemory != nil {
		log.Printf("✓ Monthly memory evolved for user %d (incorporated %d new weekly memories)", userID, len(weeklyMemories))
	} else {
		log.Printf("✓ Monthly memory created for user %d (consolidated %d weekly memories)", userID, len(weeklyMemories))
	}
	return nil
}

// GenerateYearlyMemory consolidates the past year's monthly memories
func (s *Service) GenerateYearlyMemory(ctx context.Context, userID int64) error {
	log.Printf("Generating yearly memory for user %d", userID)

	// Get last year's date range
	now := time.Now()
	endDate := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, now.Location())
	startDate := endDate.AddDate(-1, 0, 0)

	// Get the most recent yearly memory (to evolve from)
	previousYearlyMemories, err := s.db.GetMemoriesByType(ctx, userID, database.MemoryTypeYearly, 1)
	if err != nil {
		return fmt.Errorf("failed to get previous yearly memory: %w", err)
	}

	var previousMemory *database.Memory
	if len(previousYearlyMemories) > 0 {
		previousMemory = previousYearlyMemories[0]
		log.Printf("Found previous yearly memory from %s, will evolve it", previousMemory.StartDate.Format("2006-01-02"))
	} else {
		log.Printf("No previous yearly memory found, will create first one")
	}

	// Get all monthly memories since the last yearly memory (or last year if no previous)
	var monthlyStartDate time.Time
	if previousMemory != nil {
		monthlyStartDate = previousMemory.EndDate
	} else {
		monthlyStartDate = startDate
	}

	monthlyMemories, err := s.db.GetMemoriesByDateRange(ctx, userID, database.MemoryTypeMonthly, monthlyStartDate, endDate)
	if err != nil {
		return fmt.Errorf("failed to get monthly memories: %w", err)
	}

	if len(monthlyMemories) == 0 {
		log.Printf("No new monthly memories found for user %d since %s, skipping yearly memory", userID, monthlyStartDate.Format("2006-01-02"))
		return nil
	}

	// Get custom prompt if available
	customPrompt := ""
	if prompt, err := s.db.GetSystemPrompt(ctx, userID, database.PromptTypeYearlySummary); err == nil {
		customPrompt = prompt.Content
	}

	// Generate consolidated memory (evolving from previous if exists)
	memoryContent, err := s.consolidateMemories(ctx, previousMemory, monthlyMemories, "yearly", customPrompt)
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

	if previousMemory != nil {
		log.Printf("✓ Yearly memory evolved for user %d (incorporated %d new monthly memories)", userID, len(monthlyMemories))
	} else {
		log.Printf("✓ Yearly memory created for user %d (consolidated %d monthly memories)", userID, len(monthlyMemories))
	}
	return nil
}

// consolidateMemories uses AI to evolve an existing memory by incorporating new lower-level memories
func (s *Service) consolidateMemories(ctx context.Context, previousMemory *database.Memory, newMemories []*database.Memory, period string, customPrompt string) (string, error) {
	systemPrompt := customPrompt
	if systemPrompt == "" {
		if previousMemory != nil {
			// Evolutionary mode: update existing memory
			systemPrompt = fmt.Sprintf(`You are an AI assistant evolving a %s email processing memory. Your task is to UPDATE the existing memory by incorporating new insights from recent lower-level memories.

DO NOT write a new memory from scratch. Instead:

**Reinforce patterns:**
- Keep and strengthen insights that are still relevant and being validated by new data
- Note when patterns continue or become more pronounced

**Amend differences:**
- Update or refine insights when new data shows changes in patterns
- Add new learnings that weren't in the previous memory
- Remove or de-emphasize insights that are no longer relevant

**Maintain continuity:**
- Build on the existing memory's structure and insights
- Show evolution over time rather than replacement
- Keep the most valuable long-term learnings

IMPORTANT: Keep your response concise - aim for around 400 words maximum. Focus only on the most significant changes and patterns. The goal is an EVOLVED memory that's better than the previous one, not a brand new memory. Format as bullet points.`, period)
		} else {
			// Initial creation mode: no previous memory exists
			systemPrompt = fmt.Sprintf(`You are an AI assistant creating the first %s email processing memory. Review the provided memories and create insights focused on:

1. Identifying overarching patterns and trends
2. Highlighting important behavioral patterns
3. Noting recurring themes
4. Providing strategic insights for email management
5. Suggesting process improvements

IMPORTANT: Keep your response concise - aim for around 800 words maximum. Focus on the most important actionable patterns. Format as bullet points.`, period)
		}
	}

	// Prepare summary of new memories
	var memorySummaries []string
	for i, mem := range newMemories {
		memorySummaries = append(memorySummaries, fmt.Sprintf("New Memory %d (%s to %s):\n%s",
			i+1,
			mem.StartDate.Format("2006-01-02"),
			mem.EndDate.Format("2006-01-02"),
			mem.Content,
		))
	}

	var userPrompt string
	if previousMemory != nil {
		// Evolutionary update
		userPrompt = fmt.Sprintf(`**CURRENT %s MEMORY (to be evolved):**
Period: %s to %s
%s

**NEW INSIGHTS FROM RECENT MEMORIES (%d new):**
%s

Task: Evolve the current memory by:
1. Reinforcing patterns that continue in the new memories
2. Updating insights where new data shows changes
3. Adding new learnings not present in current memory
4. Removing outdated insights

Output an evolved %s memory that builds on the current one.`,
			strings.ToUpper(period),
			previousMemory.StartDate.Format("2006-01-02"),
			previousMemory.EndDate.Format("2006-01-02"),
			previousMemory.Content,
			len(newMemories),
			strings.Join(memorySummaries, "\n\n"),
			period)
	} else {
		// Initial creation
		userPrompt = fmt.Sprintf(`Create the first %s memory by consolidating these %d memories:

%s

Provide a concise %s summary with key patterns and strategic insights.`,
			period,
			len(newMemories),
			strings.Join(memorySummaries, "\n\n"),
			period)
	}

	// Call AI to generate consolidated memory
	memory, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		return "", err
	}

	return memory, nil
}

// GenerateAIPrompts regenerates both AI-written prompts using the latest weekly memory.
// Called after weekly memory generation. For each prompt type (email_analyze, email_actions):
// 1. Loads the user-written system prompt
// 2. Loads the latest AI-written prompt (if any)
// 3. Loads the most recent weekly memory
// 4. Generates a new AI prompt version
func (s *Service) GenerateAIPrompts(ctx context.Context, userID int64) error {
	// Get the most recent weekly memory
	weeklyMemories, err := s.db.GetMemoriesByType(ctx, userID, database.MemoryTypeWeekly, 1)
	if err != nil {
		return fmt.Errorf("failed to get weekly memory: %w", err)
	}
	if len(weeklyMemories) == 0 {
		log.Printf("No weekly memory found for user %d, skipping AI prompt generation", userID)
		return nil
	}
	weeklyMemory := weeklyMemories[0]

	// Generate for both prompt types
	promptTypes := []struct {
		aiType   database.AIPromptType
		userType database.PromptType
		label    string
	}{
		{database.AIPromptTypeEmailAnalyze, database.PromptTypeEmailAnalyze, "email analysis"},
		{database.AIPromptTypeEmailActions, database.PromptTypeEmailActions, "email actions"},
	}

	var errs []error
	for _, pt := range promptTypes {
		if err := s.generateSingleAIPrompt(ctx, userID, pt.aiType, pt.userType, pt.label, weeklyMemory); err != nil {
			log.Printf("Failed to generate AI prompt for %s (user %d): %v", pt.label, userID, err)
			errs = append(errs, err)
			// Continue with the other prompt type
		}
	}

	if len(errs) == len(promptTypes) {
		return fmt.Errorf("all AI prompt generations failed")
	}
	return nil
}

func (s *Service) generateSingleAIPrompt(ctx context.Context, userID int64, aiType database.AIPromptType, userPromptType database.PromptType, label string, weeklyMemory *database.Memory) error {
	// 1. Get user-written system prompt
	userPromptContent := ""
	if userPrompt, err := s.db.GetSystemPrompt(ctx, userID, userPromptType); err == nil {
		userPromptContent = userPrompt.Content
	}

	// 2. Get latest AI-written prompt
	previousAIContent := ""
	if aiPrompt, err := s.db.GetLatestAIPrompt(ctx, userID, aiType); err == nil && aiPrompt != nil {
		previousAIContent = aiPrompt.Content
	}

	// 3. Build the meta-prompt
	systemPrompt := fmt.Sprintf(`You are an AI assistant that writes supplementary system prompt instructions for %s.

Your job is to write additional instructions that will be APPENDED to the user's system prompt when processing emails. These instructions should encode specific learnings, patterns, exceptions, and refinements discovered from processing emails over time.

Rules:
- NEVER contradict the user's original prompt - your instructions supplement it
- Be specific and actionable (e.g., "Emails from noreply@github.com with 'security alert' in subject should be labeled Urgent")
- Include sender-specific rules, content patterns, and learned exceptions
- Remove outdated rules that no longer apply
- Keep your output concise - aim for 200-500 words of clear, direct instructions
- Write in imperative form as instructions to an AI assistant (e.g., "Label X as Y", "Archive emails from Z")
- Do NOT include explanations of why - just the rules themselves`, label)

	var userPrompt string
	if previousAIContent != "" {
		userPrompt = fmt.Sprintf(`**USER'S ORIGINAL PROMPT (never modify, your output supplements this):**
%s

**YOUR PREVIOUS VERSION (evolve this):**
%s

**LATEST WEEKLY MEMORY (new learnings to incorporate):**
%s

Write an updated version of the supplementary instructions. Reinforce rules that continue to be relevant, add new rules from the weekly memory, and remove any that are outdated.`,
			userPromptContent, previousAIContent, weeklyMemory.Content)
	} else {
		userPrompt = fmt.Sprintf(`**USER'S ORIGINAL PROMPT (never modify, your output supplements this):**
%s

**LATEST WEEKLY MEMORY (learnings to base initial rules on):**
%s

Write the first version of supplementary instructions based on the patterns and learnings from the weekly memory.`,
			userPromptContent, weeklyMemory.Content)
	}

	// 4. Generate via OpenAI
	content, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		return fmt.Errorf("failed to generate AI prompt: %w", err)
	}

	// 5. Save new version
	aiPrompt := &database.AIPrompt{
		UserID:  userID,
		Type:    aiType,
		Content: content,
	}
	if err := s.db.CreateAIPrompt(ctx, aiPrompt); err != nil {
		return fmt.Errorf("failed to save AI prompt: %w", err)
	}

	log.Printf("✓ AI prompt for %s generated (user %d, version %d)", label, userID, aiPrompt.Version)
	return nil
}
