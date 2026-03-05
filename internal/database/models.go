package database

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// User represents an authenticated user
type User struct {
	ID            int64      `db:"id" json:"id"`
	Email         string     `db:"email" json:"email"`                 // User's Gmail address
	GoogleID      string     `db:"google_id" json:"google_id"`         // Google user ID
	AccessToken   string     `db:"access_token" json:"-"`              // OAuth access token (not exposed in JSON)
	RefreshToken  string     `db:"refresh_token" json:"-"`             // OAuth refresh token (not exposed in JSON)
	TokenExpiry   time.Time  `db:"token_expiry" json:"token_expiry"`   // When access token expires
	IsActive         bool       `db:"is_active" json:"is_active"`         // Whether monitoring is enabled
	LastCheckedAt    *time.Time `db:"last_checked_at" json:"last_checked_at"` // Last time Gmail was checked for this user
	PushoverUserKey  string     `db:"pushover_user_key" json:"-"`  // Pushover user key (not exposed in JSON)
	PushoverAppToken string     `db:"pushover_app_token" json:"-"` // Pushover app token (not exposed in JSON)
	CreatedAt        time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt        time.Time  `db:"updated_at" json:"updated_at"`
}

// Email represents the analysis results for a single email
type Email struct {
	ID            string    `db:"id" json:"id"`                       // Gmail message ID
	UserID        int64     `db:"user_id" json:"user_id"`             // User who owns this email
	FromAddress   string    `db:"from_address" json:"from_address"`   // Sender email address
	Subject       string    `db:"subject" json:"subject"`             // Email subject
	Slug          string    `db:"slug" json:"slug"`                   // snake_case slug like "marketing_newsletter"
	Keywords      []string  `db:"keywords" json:"keywords"`           // Array of keywords
	Summary       string    `db:"summary" json:"summary"`             // Single line summary
	LabelsApplied []string  `db:"labels_applied" json:"labels_applied"` // Labels applied to email
	BypassedInbox bool      `db:"bypassed_inbox" json:"bypassed_inbox"` // Whether email bypassed inbox
	Reasoning        string    `db:"reasoning" json:"reasoning"`           // AI reasoning for actions taken
	HumanFeedback    string    `db:"human_feedback" json:"human_feedback"` // Human feedback: "do differently next time"
	FeedbackDirty    bool      `db:"feedback_dirty" json:"feedback_dirty"` // Whether feedback needs to be included in next memory
	NotificationSent bool      `db:"notification_sent" json:"notification_sent"` // Whether a push notification was sent
	ProcessedAt      time.Time `db:"processed_at" json:"processed_at"`   // When email was processed
	CreatedAt        time.Time `db:"created_at" json:"created_at"`       // When record was created
}

// HasPushoverConfig returns true if the user has Pushover credentials configured
func (u *User) HasPushoverConfig() bool {
	return u.PushoverUserKey != "" && u.PushoverAppToken != ""
}

// Label represents a Gmail label with its configuration
type Label struct {
	ID          int64     `db:"id" json:"id"`
	UserID      int64     `db:"user_id" json:"user_id"`     // User who owns this label config
	Name        string    `db:"name" json:"name"`           // Gmail label name
	Reasons     []string  `db:"reasons" json:"reasons"`     // Reasons to use this label
	Description string    `db:"description" json:"description"` // Optional description
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at" json:"updated_at"`
}

// SystemPrompt stores the configurable system prompt for different AI operations
type SystemPrompt struct {
	ID          int64      `db:"id" json:"id"`
	UserID      int64      `db:"user_id" json:"user_id"`     // User who owns this prompt
	Type        PromptType `db:"type" json:"type"`           // Type of prompt (email_analyze, email_actions, etc.)
	Content     string     `db:"content" json:"content"`     // The actual prompt text
	IsActive    bool       `db:"is_active" json:"is_active"` // Whether this prompt is currently active
	Description string     `db:"description" json:"description"` // Optional description of what this prompt does
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
}

type PromptType string

const (
	PromptTypeEmailAnalyze    PromptType = "email_analyze"    // Content analysis: slug, keywords, summary
	PromptTypeEmailActions    PromptType = "email_actions"    // Action generation: labels, inbox bypass
	PromptTypeDailyReview     PromptType = "daily_review"     // Daily decision review (5PM)
	PromptTypeWeeklySummary   PromptType = "weekly_summary"   // Weekly memory consolidation
	PromptTypeMonthlySummary  PromptType = "monthly_summary"  // Monthly memory consolidation
	PromptTypeYearlySummary   PromptType = "yearly_summary"   // Yearly memory consolidation
	PromptTypeWrapUpReport    PromptType = "wrapup_report"    // 8AM & 5PM wrap-up reports
)

// Memory represents consolidated learning from email processing
type Memory struct {
	ID        int64      `db:"id" json:"id"`
	UserID    int64      `db:"user_id" json:"user_id"`     // User who owns this memory
	Type      MemoryType `db:"type" json:"type"`           // daily, weekly, monthly, yearly
	Content   string     `db:"content" json:"content"`     // The consolidated memory
	Reasoning string     `db:"reasoning" json:"reasoning"` // AI reasoning for editorial decisions
	StartDate time.Time  `db:"start_date" json:"start_date"` // Period start
	EndDate   time.Time  `db:"end_date" json:"end_date"`   // Period end
	CreatedAt time.Time  `db:"created_at" json:"created_at"`
}

type MemoryType string

const (
	MemoryTypeDaily   MemoryType = "daily"
	MemoryTypeWeekly  MemoryType = "weekly"
	MemoryTypeMonthly MemoryType = "monthly"
	MemoryTypeYearly  MemoryType = "yearly"
)

// AIPrompt stores AI-generated prompt supplements that evolve over time
type AIPrompt struct {
	ID        int64        `db:"id" json:"id"`
	UserID    int64        `db:"user_id" json:"user_id"`
	Type      AIPromptType `db:"type" json:"type"`
	Content   string       `db:"content" json:"content"`
	Version   int          `db:"version" json:"version"`
	CreatedAt time.Time    `db:"created_at" json:"created_at"`
}

type AIPromptType string

const (
	AIPromptTypeEmailAnalyze AIPromptType = "email_analyze"
	AIPromptTypeEmailActions AIPromptType = "email_actions"
)

// SenderProfile stores intelligence about an email sender or domain
type SenderProfile struct {
	ID             int64          `db:"id" json:"id"`
	UserID         int64          `db:"user_id" json:"user_id"`
	ProfileType    ProfileType    `db:"profile_type" json:"profile_type"`
	Identifier     string         `db:"identifier" json:"identifier"`

	EmailCount     int            `db:"email_count" json:"email_count"`
	EmailsArchived int            `db:"emails_archived" json:"emails_archived"`
	EmailsNotified int            `db:"emails_notified" json:"emails_notified"`
	SlugCounts     map[string]int `db:"slug_counts" json:"slug_counts"`
	LabelCounts    map[string]int `db:"label_counts" json:"label_counts"`
	KeywordCounts  map[string]int `db:"keyword_counts" json:"keyword_counts"`

	SenderType     string    `db:"sender_type" json:"sender_type"`
	Summary        string    `db:"summary" json:"summary"`

	FirstSeenAt    time.Time `db:"first_seen_at" json:"first_seen_at"`
	LastSeenAt     time.Time `db:"last_seen_at" json:"last_seen_at"`
	ModifiedAt     time.Time `db:"modified_at" json:"modified_at"`
	CreatedAt      time.Time `db:"created_at" json:"created_at"`
}

type ProfileType string

const (
	ProfileTypeSender ProfileType = "sender"
	ProfileTypeDomain ProfileType = "domain"
)

// IgnoredDomains lists free/consumer email providers that should not have domain profiles
var IgnoredDomains = map[string]bool{
	"gmail.com": true, "googlemail.com": true,
	"hotmail.com": true, "outlook.com": true, "live.com": true,
	"yahoo.com": true, "yahoo.co.uk": true, "aol.com": true,
	"icloud.com": true, "me.com": true, "mac.com": true,
	"protonmail.com": true, "proton.me": true,
	"zoho.com": true, "mail.com": true,
	"gmx.com": true, "gmx.net": true,
	"yandex.com": true, "tutanota.com": true, "fastmail.com": true,
}

// IsIgnoredDomain returns true if domain profiles should not be created for this domain
func IsIgnoredDomain(domain string) bool {
	return IgnoredDomains[strings.ToLower(domain)]
}

// ExtractDomain extracts the domain part from an email address
func ExtractDomain(email string) string {
	if i := strings.LastIndex(email, "@"); i >= 0 {
		return strings.ToLower(email[i+1:])
	}
	return ""
}

// topN returns the top N keys from a map sorted by descending count, formatted as "key (count)"
func topN(counts map[string]int, n int) []string {
	type kv struct {
		Key   string
		Count int
	}
	var sorted []kv
	for k, v := range counts {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Count > sorted[j].Count
	})
	if len(sorted) > n {
		sorted = sorted[:n]
	}
	result := make([]string, len(sorted))
	for i, kv := range sorted {
		result[i] = fmt.Sprintf("%s (%d)", kv.Key, kv.Count)
	}
	return result
}

// TopSlugs returns the top N slugs by count, formatted as "slug (count)"
func (p *SenderProfile) TopSlugs(n int) []string {
	return topN(p.SlugCounts, n)
}

// TopLabels returns the top N labels by count, formatted as "label (count)"
func (p *SenderProfile) TopLabels(n int) []string {
	return topN(p.LabelCounts, n)
}

// TopKeywords returns the top N keywords by count, formatted as "keyword (count)"
func (p *SenderProfile) TopKeywords(n int) []string {
	return topN(p.KeywordCounts, n)
}

// BypassInboxRate returns the fraction of emails that were archived
func (p *SenderProfile) BypassInboxRate() float64 {
	if p.EmailCount == 0 {
		return 0
	}
	return float64(p.EmailsArchived) / float64(p.EmailCount)
}

// NotificationRate returns the fraction of emails that triggered notifications
func (p *SenderProfile) NotificationRate() float64 {
	if p.EmailCount == 0 {
		return 0
	}
	return float64(p.EmailsNotified) / float64(p.EmailCount)
}

// FormatForPrompt produces a concise text block for AI context
func (p *SenderProfile) FormatForPrompt() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Type: %s | Emails: %d | Archive rate: %.0f%% | Notification rate: %.0f%%\n",
		p.SenderType, p.EmailCount, p.BypassInboxRate()*100, p.NotificationRate()*100)

	if slugs := p.TopSlugs(5); len(slugs) > 0 {
		fmt.Fprintf(&b, "Top slugs: %s\n", strings.Join(slugs, ", "))
	}
	if labels := p.TopLabels(5); len(labels) > 0 {
		fmt.Fprintf(&b, "Top labels: %s\n", strings.Join(labels, ", "))
	}
	if p.Summary != "" {
		fmt.Fprintf(&b, "Summary: %s\n", p.Summary)
	}
	return b.String()
}

