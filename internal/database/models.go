package database

import "time"

// Email represents the analysis results for a single email
type Email struct {
	ID           string    `db:"id" json:"id"`                       // Gmail message ID
	FromAddress  string    `db:"from_address" json:"from_address"`   // Sender email address
	Subject      string    `db:"subject" json:"subject"`             // Email subject
	Slug         string    `db:"slug" json:"slug"`                   // snake_case slug like "marketing_newsletter"
	Keywords     []string  `db:"keywords" json:"keywords"`           // Array of keywords
	Summary      string    `db:"summary" json:"summary"`             // Single line summary
	LabelsApplied []string `db:"labels_applied" json:"labels_applied"` // Labels applied to email
	BypassedInbox bool     `db:"bypassed_inbox" json:"bypassed_inbox"` // Whether email bypassed inbox
	ProcessedAt  time.Time `db:"processed_at" json:"processed_at"`   // When email was processed
	CreatedAt    time.Time `db:"created_at" json:"created_at"`       // When record was created
}

// Label represents a Gmail label with its configuration
type Label struct {
	ID          int64     `db:"id" json:"id"`
	Name        string    `db:"name" json:"name"`               // Gmail label name
	Reasons     []string  `db:"reasons" json:"reasons"`         // Reasons to use this label
	Description string    `db:"description" json:"description"` // Optional description
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at" json:"updated_at"`
}

// SystemPrompt stores the configurable system prompt for different AI operations
type SystemPrompt struct {
	ID          int64      `db:"id" json:"id"`
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

// WrapUpReport stores the 8AM and 5PM wrap-up reports
type WrapUpReport struct {
	ID          int64     `db:"id" json:"id"`
	ReportTime  time.Time `db:"report_time" json:"report_time"` // When report was generated
	EmailCount  int       `db:"email_count" json:"email_count"` // Number of emails processed
	Content     string    `db:"content" json:"content"`         // Report content
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
}
