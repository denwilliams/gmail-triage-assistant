package database

import "time"

// User represents an authenticated user
type User struct {
	ID            int64      `db:"id" json:"id"`
	Email         string     `db:"email" json:"email"`                 // User's Gmail address
	GoogleID      string     `db:"google_id" json:"google_id"`         // Google user ID
	AccessToken   string     `db:"access_token" json:"-"`              // OAuth access token (not exposed in JSON)
	RefreshToken  string     `db:"refresh_token" json:"-"`             // OAuth refresh token (not exposed in JSON)
	TokenExpiry   time.Time  `db:"token_expiry" json:"token_expiry"`   // When access token expires
	IsActive      bool       `db:"is_active" json:"is_active"`         // Whether monitoring is enabled
	LastCheckedAt *time.Time `db:"last_checked_at" json:"last_checked_at"` // Last time Gmail was checked for this user
	CreatedAt     time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt     time.Time  `db:"updated_at" json:"updated_at"`
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
	Reasoning     string    `db:"reasoning" json:"reasoning"`           // AI reasoning for actions taken
	HumanFeedback string    `db:"human_feedback" json:"human_feedback"` // Human feedback: "do differently next time"
	ProcessedAt   time.Time `db:"processed_at" json:"processed_at"`   // When email was processed
	CreatedAt     time.Time `db:"created_at" json:"created_at"`       // When record was created
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

// WrapUpReport stores the 8AM and 5PM wrap-up reports
type WrapUpReport struct {
	ID          int64     `db:"id" json:"id"`
	UserID      int64     `db:"user_id" json:"user_id"`     // User who owns this report
	ReportTime  time.Time `db:"report_time" json:"report_time"` // When report was generated
	EmailCount  int       `db:"email_count" json:"email_count"` // Number of emails processed
	Content     string    `db:"content" json:"content"`         // Report content
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
}
