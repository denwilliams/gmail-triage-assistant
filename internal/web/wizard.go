package web

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/den/gmail-triage-assistant/internal/database"
)

const wizardSystemPrompt = `You are a setup wizard for an AI email triage assistant. Your goal is to understand the user's email management preferences by asking targeted questions, then generate two tailored system prompts.

You will receive an email summary with statistics about the user's recent emails (senders, domains, slugs, labels, keywords, bypass/notification rates). Use this data to ask personalized, relevant questions.

## Rules
- Ask 3-5 questions per round, 2-3 rounds total before generating prompts.
- Reference actual senders, domains, and patterns from their email data.
- Question types: single_select (radio), multi_select (checkboxes), text (free input).
- Keep options concise and actionable.
- After enough information, set done=true and generate both prompts.

## Question Topics (spread across rounds)
Round 1 - Email priorities & senders:
- Which senders are most important to them
- What types of emails should always stay in inbox
- General archiving philosophy (aggressive vs conservative)

Round 2 - Labels & organization:
- How they want emails categorized
- Any senders/domains that should always get specific labels
- Notification preferences (what warrants an alert)

Round 3 (if needed) - Fine-tuning:
- Edge cases or special rules
- Summary/slug preferences
- Any other preferences

## Prompt Generation
When done=true, generate two prompts:

**email_analyze** - System prompt for Stage 1 (content analysis):
- Instructs AI to generate a snake_case slug categorizing the email
- Extract 3-5 keywords
- Write a single-line summary (max 100 chars)
- Incorporate user preferences about categorization

**email_actions** - System prompt for Stage 2 (action generation):
- Instructs AI to decide: labels to apply, whether to bypass inbox (archive), notification message
- Incorporate user preferences about important senders, archiving rules, notification triggers
- Reference the actual label names and their purposes
- Include user's archiving philosophy and notification preferences

When done=false, set prompts to empty strings. When done=true, set questions to an empty array.`

// WizardHistoryEntry represents a single Q&A exchange in the wizard conversation
type WizardHistoryEntry struct {
	QuestionID string `json:"question_id"`
	Question   string `json:"question"`
	Answer     string `json:"answer"`
}

// POST /api/v1/prompt-wizard/start
func (s *Server) handleAPIPromptWizardStart(w http.ResponseWriter, r *http.Request) {
	session, _ := s.sessionStore.Get(r, "session")
	userID := session.Values["user_id"].(int64)

	ctx := context.Background()

	// Fetch 2 weeks of emails
	now := time.Now()
	twoWeeksAgo := now.AddDate(0, 0, -14)
	emails, err := s.db.GetEmailsByDateRange(ctx, userID, twoWeeksAgo, now)
	if err != nil {
		log.Printf("API: Failed to fetch emails for wizard: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to fetch email data")
		return
	}

	// Fetch labels
	labels, err := s.db.GetUserLabelsWithDetails(ctx, userID)
	if err != nil {
		log.Printf("API: Failed to fetch labels for wizard: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to fetch labels")
		return
	}

	// Fetch existing prompts
	prompts, err := s.db.GetAllSystemPrompts(ctx, userID)
	if err != nil {
		log.Printf("API: Failed to fetch prompts for wizard: %v", err)
		respondError(w, http.StatusInternalServerError, "Failed to fetch prompts")
		return
	}

	emailSummary := buildWizardEmailSummary(emails, labels, prompts)

	userPrompt := fmt.Sprintf("Here is my email data from the last 2 weeks:\n\n%s\n\nPlease start the setup wizard by asking your first round of questions.", emailSummary)

	result, err := s.openaiClient.RunPromptWizard(ctx, wizardSystemPrompt, userPrompt)
	if err != nil {
		log.Printf("API: Wizard AI call failed: %v", err)
		respondError(w, http.StatusInternalServerError, "AI wizard failed")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"done":          result.Done,
		"message":       result.Message,
		"questions":     result.Questions,
		"prompts":       result.Prompts,
		"email_summary": emailSummary,
	})
}

// POST /api/v1/prompt-wizard/continue
func (s *Server) handleAPIPromptWizardContinue(w http.ResponseWriter, r *http.Request) {
	var body struct {
		EmailSummary string               `json:"email_summary"`
		History      []WizardHistoryEntry `json:"history"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if body.EmailSummary == "" {
		respondError(w, http.StatusBadRequest, "email_summary is required")
		return
	}

	ctx := context.Background()
	userPrompt := buildWizardConversationPrompt(body.EmailSummary, body.History)

	result, err := s.openaiClient.RunPromptWizard(ctx, wizardSystemPrompt, userPrompt)
	if err != nil {
		log.Printf("API: Wizard AI continue call failed: %v", err)
		respondError(w, http.StatusInternalServerError, "AI wizard failed")
		return
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"done":      result.Done,
		"message":   result.Message,
		"questions": result.Questions,
		"prompts":   result.Prompts,
	})
}

// buildWizardEmailSummary aggregates email data into a compact text summary (~1000 tokens)
func buildWizardEmailSummary(emails []*database.Email, labels []*database.Label, prompts []*database.SystemPrompt) string {
	var b strings.Builder

	totalEmails := len(emails)
	if totalEmails == 0 {
		b.WriteString("No emails found in the last 2 weeks.\n")
		return b.String()
	}

	// Volume
	days := 14
	dailyAvg := float64(totalEmails) / float64(days)
	b.WriteString(fmt.Sprintf("## Volume\nTotal: %d emails over 14 days (%.1f/day avg)\n\n", totalEmails, dailyAvg))

	// Count senders, domains, slugs, labels, keywords, bypass, notifications
	senderCounts := make(map[string]int)
	senderArchived := make(map[string]int)
	senderLabels := make(map[string]map[string]bool)
	domainCounts := make(map[string]int)
	domainArchived := make(map[string]int)
	slugCounts := make(map[string]int)
	labelCounts := make(map[string]int)
	keywordCounts := make(map[string]int)
	var bypassed, notified int

	for _, e := range emails {
		senderCounts[e.FromAddress]++
		if e.BypassedInbox {
			senderArchived[e.FromAddress]++
			bypassed++
		}
		if e.NotificationSent {
			notified++
		}

		domain := database.ExtractDomain(e.FromAddress)
		if domain != "" {
			domainCounts[domain]++
			if e.BypassedInbox {
				domainArchived[domain]++
			}
		}

		if e.Slug != "" {
			slugCounts[e.Slug]++
		}
		for _, l := range e.LabelsApplied {
			labelCounts[l]++
		}
		for _, kw := range e.Keywords {
			keywordCounts[kw]++
		}

		// Track labels per sender
		if _, ok := senderLabels[e.FromAddress]; !ok {
			senderLabels[e.FromAddress] = make(map[string]bool)
		}
		for _, l := range e.LabelsApplied {
			senderLabels[e.FromAddress][l] = true
		}
	}

	// Top 15 senders
	type kv struct {
		Key   string
		Count int
	}
	topSenders := sortedTopN(senderCounts, 15)
	b.WriteString("## Top Senders\n")
	for _, s := range topSenders {
		archiveRate := float64(senderArchived[s.Key]) / float64(s.Count) * 100
		lbls := mapKeys(senderLabels[s.Key])
		lblStr := ""
		if len(lbls) > 0 {
			lblStr = fmt.Sprintf(" [labels: %s]", strings.Join(lbls, ", "))
		}
		b.WriteString(fmt.Sprintf("- %s: %d emails, %.0f%% archived%s\n", s.Key, s.Count, archiveRate, lblStr))
	}
	b.WriteString("\n")

	// Top 10 domains
	topDomains := sortedTopN(domainCounts, 10)
	b.WriteString("## Top Domains\n")
	for _, d := range topDomains {
		archiveRate := float64(domainArchived[d.Key]) / float64(d.Count) * 100
		b.WriteString(fmt.Sprintf("- %s: %d emails, %.0f%% archived\n", d.Key, d.Count, archiveRate))
	}
	b.WriteString("\n")

	// Top 15 slugs
	topSlugs := sortedTopN(slugCounts, 15)
	b.WriteString("## Top Email Categories (slugs)\n")
	for _, s := range topSlugs {
		b.WriteString(fmt.Sprintf("- %s: %d\n", s.Key, s.Count))
	}
	b.WriteString("\n")

	// Label distribution
	b.WriteString("## Label Distribution\n")
	topLabels := sortedTopN(labelCounts, 20)
	for _, l := range topLabels {
		b.WriteString(fmt.Sprintf("- %s: %d\n", l.Key, l.Count))
	}
	b.WriteString("\n")

	// Top 20 keywords
	topKeywords := sortedTopN(keywordCounts, 20)
	b.WriteString("## Top Keywords\n")
	for _, k := range topKeywords {
		b.WriteString(fmt.Sprintf("- %s: %d\n", k.Key, k.Count))
	}
	b.WriteString("\n")

	// Rates
	bypassRate := float64(bypassed) / float64(totalEmails) * 100
	notifRate := float64(notified) / float64(totalEmails) * 100
	b.WriteString(fmt.Sprintf("## Rates\nBypass inbox: %.1f%%\nNotification: %.1f%%\n\n", bypassRate, notifRate))

	// Label configs with reasons
	if len(labels) > 0 {
		b.WriteString("## Configured Labels\n")
		for _, l := range labels {
			b.WriteString(fmt.Sprintf("- %s", l.Name))
			if l.Description != "" {
				b.WriteString(fmt.Sprintf(": %s", l.Description))
			}
			if len(l.Reasons) > 0 {
				b.WriteString(fmt.Sprintf(" (reasons: %s)", strings.Join(l.Reasons, "; ")))
			}
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	// Existing prompts summary
	for _, p := range prompts {
		if p.Type == database.PromptTypeEmailAnalyze || p.Type == database.PromptTypeEmailActions {
			content := p.Content
			if len(content) > 200 {
				content = content[:200] + "..."
			}
			b.WriteString(fmt.Sprintf("## Current %s prompt (preview)\n%s\n\n", p.Type, content))
		}
	}

	return b.String()
}

// buildWizardConversationPrompt serializes the email summary and Q&A history into a user prompt
func buildWizardConversationPrompt(emailSummary string, history []WizardHistoryEntry) string {
	var b strings.Builder

	b.WriteString("Here is my email data from the last 2 weeks:\n\n")
	b.WriteString(emailSummary)
	b.WriteString("\n\n## Our conversation so far:\n\n")

	for _, h := range history {
		b.WriteString(fmt.Sprintf("Q (%s): %s\nA: %s\n\n", h.QuestionID, h.Question, h.Answer))
	}

	b.WriteString("Based on my answers, please continue with the next round of questions, or if you have enough information, generate the final prompts.")

	return b.String()
}

type kvPair struct {
	Key   string
	Count int
}

func sortedTopN(m map[string]int, n int) []kvPair {
	pairs := make([]kvPair, 0, len(m))
	for k, v := range m {
		pairs = append(pairs, kvPair{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].Count > pairs[j].Count
	})
	if len(pairs) > n {
		pairs = pairs[:n]
	}
	return pairs
}

func mapKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
