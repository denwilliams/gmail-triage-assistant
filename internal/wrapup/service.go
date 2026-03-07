package wrapup

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
	"github.com/den/gmail-triage-assistant/internal/gmail"
	"github.com/den/gmail-triage-assistant/internal/openai"
	"golang.org/x/oauth2"
)

type Service struct {
	db          *database.DB
	openai      *openai.Client
	oauthConfig *oauth2.Config
}

func NewService(db *database.DB, openaiClient *openai.Client, oauthConfig *oauth2.Config) *Service {
	return &Service{
		db:          db,
		openai:      openaiClient,
		oauthConfig: oauthConfig,
	}
}

// GenerateMorningWrapup creates a summary of emails processed overnight (since last evening)
func (s *Service) GenerateMorningWrapup(ctx context.Context, user *database.User) error {
	log.Printf("Generating morning wrapup for user %s", user.Email)

	now := time.Now()
	// Get emails since 5PM yesterday
	yesterday := now.AddDate(0, 0, -1)
	since := time.Date(yesterday.Year(), yesterday.Month(), yesterday.Day(), 17, 0, 0, 0, yesterday.Location())

	emails, err := s.db.GetEmailsByDateRange(ctx, user.ID, since, now)
	if err != nil {
		return fmt.Errorf("failed to get emails: %w", err)
	}

	if len(emails) == 0 {
		log.Printf("No emails since yesterday evening for user %s, skipping morning wrapup", user.Email)
		return nil
	}

	content, err := s.generateWrapupContent(ctx, emails, "morning")
	if err != nil {
		return fmt.Errorf("failed to generate wrapup: %w", err)
	}

	report := &database.WrapupReport{
		UserID:      user.ID,
		ReportType:  "morning",
		Content:     content,
		EmailCount:  len(emails),
		GeneratedAt: now,
	}

	if err := s.db.CreateWrapupReport(ctx, report); err != nil {
		return fmt.Errorf("failed to save wrapup: %w", err)
	}

	log.Printf("✓ Morning wrapup saved for user %s (%d emails)", user.Email, len(emails))

	subject := fmt.Sprintf("Morning Wrapup - %s (%d emails)", now.Format("Jan 2"), len(emails))
	if err := s.sendWrapupEmail(ctx, user, subject, content); err != nil {
		log.Printf("Failed to email morning wrapup to %s: %v", user.Email, err)
	}

	return nil
}

// GenerateEveningWrapup creates a summary of emails processed during the day
func (s *Service) GenerateEveningWrapup(ctx context.Context, user *database.User) error {
	log.Printf("Generating evening wrapup for user %s", user.Email)

	now := time.Now()
	// Get emails since 8AM today
	today := time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, now.Location())

	emails, err := s.db.GetEmailsByDateRange(ctx, user.ID, today, now)
	if err != nil {
		return fmt.Errorf("failed to get emails: %w", err)
	}

	if len(emails) == 0 {
		log.Printf("No emails since this morning for user %s, skipping evening wrapup", user.Email)
		return nil
	}

	content, err := s.generateWrapupContent(ctx, emails, "evening")
	if err != nil {
		return fmt.Errorf("failed to generate wrapup: %w", err)
	}

	report := &database.WrapupReport{
		UserID:      user.ID,
		ReportType:  "evening",
		Content:     content,
		EmailCount:  len(emails),
		GeneratedAt: now,
	}

	if err := s.db.CreateWrapupReport(ctx, report); err != nil {
		return fmt.Errorf("failed to save wrapup: %w", err)
	}

	log.Printf("✓ Evening wrapup saved for user %s (%d emails)", user.Email, len(emails))

	subject := fmt.Sprintf("Evening Wrapup - %s (%d emails)", now.Format("Jan 2"), len(emails))
	if err := s.sendWrapupEmail(ctx, user, subject, content); err != nil {
		log.Printf("Failed to email evening wrapup to %s: %v", user.Email, err)
	}

	return nil
}

func (s *Service) generateWrapupContent(ctx context.Context, emails []*database.Email, reportType string) (string, error) {
	stats := buildWrapupStats(emails, reportType)

	aiSummary := s.generateAISummary(ctx, emails, reportType)

	if aiSummary != "" {
		return "Summary\n" + aiSummary + "\n\n" + stats, nil
	}
	return stats, nil
}

// buildWrapupStats computes deterministic stats from emails — no AI needed.
func buildWrapupStats(emails []*database.Email, reportType string) string {
	now := time.Now()
	total := len(emails)

	title := "Morning Wrapup"
	if reportType == "evening" {
		title = "Evening Wrapup"
	}

	// Count inbox vs archived
	inboxCount := 0
	archivedCount := 0
	for _, e := range emails {
		if e.BypassedInbox {
			archivedCount++
		} else {
			inboxCount++
		}
	}

	// Top senders
	senderCounts := map[string]int{}
	for _, e := range emails {
		senderCounts[e.FromAddress]++
	}
	topSenders := topN(senderCounts, 5)

	// Labels
	labelCounts := map[string]int{}
	for _, e := range emails {
		for _, l := range e.LabelsApplied {
			labelCounts[l]++
		}
	}
	topLabels := topN(labelCounts, 5)

	// Common types (slugs)
	slugCounts := map[string]int{}
	for _, e := range emails {
		if e.Slug != "" {
			slugCounts[e.Slug]++
		}
	}
	topSlugs := topN(slugCounts, 5)

	// Build output
	var b strings.Builder

	header := fmt.Sprintf("%s — %s (%d emails)", title, now.Format("Jan 2"), total)
	divider := strings.Repeat("═", len(header))
	fmt.Fprintf(&b, "%s\n%s\n%s\n", divider, header, divider)

	fmt.Fprintf(&b, "\nOverview\nInbox: %d  |  Archived: %d\n", inboxCount, archivedCount)

	if len(topSenders) > 0 {
		b.WriteString("\nTop Senders\n")
		writeTable(&b, topSenders)
	}

	if len(topLabels) > 0 {
		b.WriteString("\nLabels\n")
		writeTable(&b, topLabels)
	}

	if len(topSlugs) > 0 {
		b.WriteString("\nCommon Types\n")
		writeTable(&b, topSlugs)
	}

	return b.String()
}

type ranked struct {
	name  string
	count int
}

// topN returns the top n items from a frequency map, sorted by count descending.
func topN(counts map[string]int, n int) []ranked {
	items := make([]ranked, 0, len(counts))
	for name, count := range counts {
		items = append(items, ranked{name, count})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].count != items[j].count {
			return items[i].count > items[j].count
		}
		return items[i].name < items[j].name
	})
	if len(items) > n {
		items = items[:n]
	}
	return items
}

// writeTable writes a left-aligned name + right-aligned count table.
func writeTable(b *strings.Builder, items []ranked) {
	maxName := 0
	for _, item := range items {
		if len(item.name) > maxName {
			maxName = len(item.name)
		}
	}
	for _, item := range items {
		fmt.Fprintf(b, "%-*s    %d\n", maxName, item.name, item.count)
	}
}

// generateAISummary asks the AI for a short 1-2 sentence summary of notable themes.
// Returns empty string on failure (logs a warning).
func (s *Service) generateAISummary(ctx context.Context, emails []*database.Email, reportType string) string {
	customPrompt := ""
	if len(emails) > 0 {
		if prompt, err := s.db.GetSystemPrompt(ctx, emails[0].UserID, database.PromptTypeWrapUpReport); err == nil {
			customPrompt = prompt.Content
		}
	}

	systemPrompt := customPrompt
	if systemPrompt == "" {
		systemPrompt = "You are an assistant summarizing a batch of processed emails. In 1-2 sentences, highlight the most notable themes or important items the user should be aware of. Be specific and actionable."
	}

	// Prepare compact email list (limit to 100)
	var lines []string
	for i, email := range emails {
		if i >= 100 {
			lines = append(lines, fmt.Sprintf("... and %d more emails", len(emails)-100))
			break
		}
		archived := ""
		if email.BypassedInbox {
			archived = " [archived]"
		}
		lines = append(lines, fmt.Sprintf("- %s: %s (labels: %s)%s",
			email.FromAddress, email.Subject,
			strings.Join(email.LabelsApplied, ", "), archived))
	}

	timeframe := "overnight"
	if reportType == "evening" {
		timeframe = "today"
	}

	userPrompt := fmt.Sprintf("Here are %d emails processed %s. Summarize the most notable themes or items in 1-2 sentences:\n\n%s",
		len(emails), timeframe, strings.Join(lines, "\n"))

	content, err := s.openai.GenerateMemory(ctx, systemPrompt, userPrompt)
	if err != nil {
		log.Printf("Warning: AI summary generation failed, omitting summary section: %v", err)
		return ""
	}

	return strings.TrimSpace(content)
}

func (s *Service) sendWrapupEmail(ctx context.Context, user *database.User, subject, content string) error {
	client, err := gmail.NewClient(ctx, s.oauthConfig, user.GetOAuth2Token())
	if err != nil {
		return fmt.Errorf("failed to create gmail client: %w", err)
	}

	if err := client.SendMessage(ctx, user.Email, subject, content); err != nil {
		return fmt.Errorf("failed to send email: %w", err)
	}

	log.Printf("✓ Wrapup emailed to %s", user.Email)
	return nil
}
