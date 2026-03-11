package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Export types — stripped of internal IDs and user_id

type ExportLabel struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Reasons     []string `json:"reasons"`
}

type ExportSystemPrompt struct {
	Type    PromptType `json:"type"`
	Content string     `json:"content"`
}

type ExportAIPrompt struct {
	Type      AIPromptType `json:"type"`
	Content   string       `json:"content"`
	Version   int          `json:"version"`
	CreatedAt time.Time    `json:"created_at"`
}

type ExportMemory struct {
	Type      MemoryType `json:"type"`
	Content   string     `json:"content"`
	Reasoning string     `json:"reasoning"`
	StartDate time.Time  `json:"start_date"`
	EndDate   time.Time  `json:"end_date"`
	CreatedAt time.Time  `json:"created_at"`
}

type ExportSenderProfile struct {
	ProfileType    ProfileType    `json:"profile_type"`
	Identifier     string         `json:"identifier"`
	EmailCount     int            `json:"email_count"`
	EmailsArchived int            `json:"emails_archived"`
	EmailsNotified int            `json:"emails_notified"`
	SlugCounts     map[string]int `json:"slug_counts"`
	LabelCounts    map[string]int `json:"label_counts"`
	KeywordCounts  map[string]int `json:"keyword_counts"`
	SenderType     string         `json:"sender_type"`
	Summary        string         `json:"summary"`
	FirstSeenAt    time.Time      `json:"first_seen_at"`
	LastSeenAt     time.Time      `json:"last_seen_at"`
}

type ExportEmail struct {
	ID               string    `json:"id"`
	FromAddress      string    `json:"from_address"`
	FromDomain       string    `json:"from_domain"`
	Subject          string    `json:"subject"`
	Slug             string    `json:"slug"`
	Keywords         []string  `json:"keywords"`
	Summary          string    `json:"summary"`
	LabelsApplied    []string  `json:"labels_applied"`
	BypassedInbox    bool      `json:"bypassed_inbox"`
	Reasoning        string    `json:"reasoning"`
	HumanFeedback    string    `json:"human_feedback"`
	FeedbackDirty    bool      `json:"feedback_dirty"`
	NotificationSent bool      `json:"notification_sent"`
	ProcessedAt      time.Time `json:"processed_at"`
	CreatedAt        time.Time `json:"created_at"`
}

type ExportWrapupReport struct {
	ReportType  string    `json:"report_type"`
	Content     string    `json:"content"`
	EmailCount  int       `json:"email_count"`
	GeneratedAt time.Time `json:"generated_at"`
}

type ExportNotification struct {
	EmailID     string    `json:"email_id"`
	FromAddress string    `json:"from_address"`
	Subject     string    `json:"subject"`
	Message     string    `json:"message"`
	SentAt      time.Time `json:"sent_at"`
}

// Envelope types

type ExportData struct {
	Labels         []ExportLabel         `json:"labels"`
	SystemPrompts  []ExportSystemPrompt  `json:"system_prompts"`
	AIPrompts      []ExportAIPrompt      `json:"ai_prompts"`
	Memories       []ExportMemory        `json:"memories"`
	SenderProfiles []ExportSenderProfile `json:"sender_profiles"`
	WrapupReports  []ExportWrapupReport  `json:"wrapup_reports"`
	Notifications  []ExportNotification  `json:"notifications"`
	Emails         []ExportEmail         `json:"emails,omitempty"`
}

type ExportEnvelope struct {
	Version       int        `json:"version"`
	ExportedAt    time.Time  `json:"exported_at"`
	App           string     `json:"app"`
	IncludeEmails bool       `json:"include_emails"`
	Data          ExportData `json:"data"`
}

type ImportResult struct {
	Labels         int `json:"labels"`
	SystemPrompts  int `json:"system_prompts"`
	AIPrompts      int `json:"ai_prompts"`
	Memories       int `json:"memories"`
	SenderProfiles int `json:"sender_profiles"`
	WrapupReports  int `json:"wrapup_reports"`
	Notifications  int `json:"notifications"`
	Emails         int `json:"emails"`
}

// --- Export methods ---

func (db *DB) ExportLabels(ctx context.Context, userID int64) ([]ExportLabel, error) {
	query := `
		SELECT name, COALESCE(description, ''), reasons
		FROM labels
		WHERE user_id = $1
		ORDER BY name
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export labels: %w", err)
	}
	defer rows.Close()

	var labels []ExportLabel
	for rows.Next() {
		var l ExportLabel
		var reasonsJSON []byte
		if err := rows.Scan(&l.Name, &l.Description, &reasonsJSON); err != nil {
			return nil, fmt.Errorf("failed to scan label: %w", err)
		}
		if err := json.Unmarshal(reasonsJSON, &l.Reasons); err != nil {
			l.Reasons = []string{}
		}
		labels = append(labels, l)
	}
	return labels, rows.Err()
}

func (db *DB) ExportSystemPrompts(ctx context.Context, userID int64) ([]ExportSystemPrompt, error) {
	query := `
		SELECT type, content
		FROM system_prompts
		WHERE user_id = $1
		ORDER BY type
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export system prompts: %w", err)
	}
	defer rows.Close()

	var prompts []ExportSystemPrompt
	for rows.Next() {
		var p ExportSystemPrompt
		if err := rows.Scan(&p.Type, &p.Content); err != nil {
			return nil, fmt.Errorf("failed to scan system prompt: %w", err)
		}
		prompts = append(prompts, p)
	}
	return prompts, rows.Err()
}

func (db *DB) ExportAIPrompts(ctx context.Context, userID int64) ([]ExportAIPrompt, error) {
	query := `
		SELECT type, content, version, created_at
		FROM ai_prompts
		WHERE user_id = $1
		ORDER BY type, version
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export AI prompts: %w", err)
	}
	defer rows.Close()

	var prompts []ExportAIPrompt
	for rows.Next() {
		var p ExportAIPrompt
		if err := rows.Scan(&p.Type, &p.Content, &p.Version, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan AI prompt: %w", err)
		}
		prompts = append(prompts, p)
	}
	return prompts, rows.Err()
}

func (db *DB) ExportMemories(ctx context.Context, userID int64) ([]ExportMemory, error) {
	query := `
		SELECT type, content, reasoning, start_date, end_date, created_at
		FROM memories
		WHERE user_id = $1
		ORDER BY start_date
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export memories: %w", err)
	}
	defer rows.Close()

	var memories []ExportMemory
	for rows.Next() {
		var m ExportMemory
		if err := rows.Scan(&m.Type, &m.Content, &m.Reasoning, &m.StartDate, &m.EndDate, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		memories = append(memories, m)
	}
	return memories, rows.Err()
}

func (db *DB) ExportSenderProfiles(ctx context.Context, userID int64) ([]ExportSenderProfile, error) {
	query := `
		SELECT profile_type, identifier,
		       email_count, emails_archived, emails_notified,
		       slug_counts, label_counts, keyword_counts,
		       sender_type, summary, first_seen_at, last_seen_at
		FROM sender_profiles
		WHERE user_id = $1
		ORDER BY identifier
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export sender profiles: %w", err)
	}
	defer rows.Close()

	var profiles []ExportSenderProfile
	for rows.Next() {
		var p ExportSenderProfile
		var slugJSON, labelJSON, kwJSON []byte
		if err := rows.Scan(
			&p.ProfileType, &p.Identifier,
			&p.EmailCount, &p.EmailsArchived, &p.EmailsNotified,
			&slugJSON, &labelJSON, &kwJSON,
			&p.SenderType, &p.Summary, &p.FirstSeenAt, &p.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan sender profile: %w", err)
		}
		p.SlugCounts = make(map[string]int)
		p.LabelCounts = make(map[string]int)
		p.KeywordCounts = make(map[string]int)
		json.Unmarshal(slugJSON, &p.SlugCounts)
		json.Unmarshal(labelJSON, &p.LabelCounts)
		json.Unmarshal(kwJSON, &p.KeywordCounts)
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

func (db *DB) ExportEmails(ctx context.Context, userID int64) ([]ExportEmail, error) {
	query := `
		SELECT id, from_address, from_domain, subject, slug, keywords, summary,
		       labels_applied, bypassed_inbox, reasoning,
		       COALESCE(human_feedback, ''), COALESCE(feedback_dirty, FALSE),
		       notification_sent, processed_at, created_at
		FROM emails
		WHERE user_id = $1
		ORDER BY processed_at
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export emails: %w", err)
	}
	defer rows.Close()

	var emails []ExportEmail
	for rows.Next() {
		var e ExportEmail
		var keywordsJSON, labelsJSON []byte
		if err := rows.Scan(
			&e.ID, &e.FromAddress, &e.FromDomain, &e.Subject, &e.Slug,
			&keywordsJSON, &e.Summary, &labelsJSON,
			&e.BypassedInbox, &e.Reasoning, &e.HumanFeedback,
			&e.FeedbackDirty, &e.NotificationSent,
			&e.ProcessedAt, &e.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan email: %w", err)
		}
		if err := json.Unmarshal(keywordsJSON, &e.Keywords); err != nil {
			e.Keywords = []string{}
		}
		if err := json.Unmarshal(labelsJSON, &e.LabelsApplied); err != nil {
			e.LabelsApplied = []string{}
		}
		emails = append(emails, e)
	}
	return emails, rows.Err()
}

func (db *DB) ExportWrapupReports(ctx context.Context, userID int64) ([]ExportWrapupReport, error) {
	query := `
		SELECT report_type, content, email_count, generated_at
		FROM wrapup_reports
		WHERE user_id = $1
		ORDER BY generated_at
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export wrapup reports: %w", err)
	}
	defer rows.Close()

	var reports []ExportWrapupReport
	for rows.Next() {
		var r ExportWrapupReport
		if err := rows.Scan(&r.ReportType, &r.Content, &r.EmailCount, &r.GeneratedAt); err != nil {
			return nil, fmt.Errorf("failed to scan wrapup report: %w", err)
		}
		reports = append(reports, r)
	}
	return reports, rows.Err()
}

func (db *DB) ExportNotifications(ctx context.Context, userID int64) ([]ExportNotification, error) {
	query := `
		SELECT email_id, from_address, subject, message, sent_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY sent_at
	`
	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to export notifications: %w", err)
	}
	defer rows.Close()

	var notifications []ExportNotification
	for rows.Next() {
		var n ExportNotification
		if err := rows.Scan(&n.EmailID, &n.FromAddress, &n.Subject, &n.Message, &n.SentAt); err != nil {
			return nil, fmt.Errorf("failed to scan notification: %w", err)
		}
		notifications = append(notifications, n)
	}
	return notifications, rows.Err()
}

// --- Import methods (all accept *sql.Tx) ---

func importLabels(ctx context.Context, tx *sql.Tx, userID int64, labels []ExportLabel) (int, error) {
	if len(labels) == 0 {
		return 0, nil
	}
	query := `
		INSERT INTO labels (user_id, name, description, reasons, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (user_id, name)
		DO UPDATE SET description = EXCLUDED.description, reasons = EXCLUDED.reasons, updated_at = NOW()
	`
	count := 0
	for _, l := range labels {
		reasonsJSON, err := json.Marshal(l.Reasons)
		if err != nil {
			return 0, fmt.Errorf("failed to marshal reasons for label %s: %w", l.Name, err)
		}
		if _, err := tx.ExecContext(ctx, query, userID, l.Name, l.Description, reasonsJSON); err != nil {
			return 0, fmt.Errorf("failed to import label %s: %w", l.Name, err)
		}
		count++
	}
	return count, nil
}

func importSystemPrompts(ctx context.Context, tx *sql.Tx, userID int64, prompts []ExportSystemPrompt) (int, error) {
	if len(prompts) == 0 {
		return 0, nil
	}
	query := `
		INSERT INTO system_prompts (user_id, type, content, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, TRUE, NOW(), NOW())
		ON CONFLICT (user_id, type)
		DO UPDATE SET content = EXCLUDED.content, is_active = TRUE, updated_at = NOW()
	`
	count := 0
	for _, p := range prompts {
		if _, err := tx.ExecContext(ctx, query, userID, p.Type, p.Content); err != nil {
			return 0, fmt.Errorf("failed to import system prompt %s: %w", p.Type, err)
		}
		count++
	}
	return count, nil
}

func importAIPrompts(ctx context.Context, tx *sql.Tx, userID int64, prompts []ExportAIPrompt) (int, error) {
	if len(prompts) == 0 {
		return 0, nil
	}
	query := `
		INSERT INTO ai_prompts (user_id, type, content, version, created_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, type, version) DO NOTHING
	`
	count := 0
	for _, p := range prompts {
		result, err := tx.ExecContext(ctx, query, userID, p.Type, p.Content, p.Version, p.CreatedAt)
		if err != nil {
			return 0, fmt.Errorf("failed to import AI prompt %s v%d: %w", p.Type, p.Version, err)
		}
		if n, _ := result.RowsAffected(); n > 0 {
			count++
		}
	}
	return count, nil
}

func importMemories(ctx context.Context, tx *sql.Tx, userID int64, memories []ExportMemory) (int, error) {
	if len(memories) == 0 {
		return 0, nil
	}
	checkQuery := `
		SELECT EXISTS(
			SELECT 1 FROM memories
			WHERE user_id = $1 AND type = $2 AND start_date = $3 AND end_date = $4
		)
	`
	insertQuery := `
		INSERT INTO memories (user_id, type, content, reasoning, start_date, end_date, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	count := 0
	for _, m := range memories {
		var exists bool
		if err := tx.QueryRowContext(ctx, checkQuery, userID, m.Type, m.StartDate, m.EndDate).Scan(&exists); err != nil {
			return 0, fmt.Errorf("failed to check memory existence: %w", err)
		}
		if exists {
			continue
		}
		if _, err := tx.ExecContext(ctx, insertQuery, userID, m.Type, m.Content, m.Reasoning, m.StartDate, m.EndDate, m.CreatedAt); err != nil {
			return 0, fmt.Errorf("failed to import memory: %w", err)
		}
		count++
	}
	return count, nil
}

func importSenderProfiles(ctx context.Context, tx *sql.Tx, userID int64, profiles []ExportSenderProfile) (int, error) {
	if len(profiles) == 0 {
		return 0, nil
	}
	query := `
		INSERT INTO sender_profiles (
			user_id, profile_type, identifier,
			email_count, emails_archived, emails_notified,
			slug_counts, label_counts, keyword_counts,
			sender_type, summary,
			first_seen_at, last_seen_at, modified_at, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
		ON CONFLICT (user_id, profile_type, identifier)
		DO UPDATE SET
			email_count = EXCLUDED.email_count,
			emails_archived = EXCLUDED.emails_archived,
			emails_notified = EXCLUDED.emails_notified,
			slug_counts = EXCLUDED.slug_counts,
			label_counts = EXCLUDED.label_counts,
			keyword_counts = EXCLUDED.keyword_counts,
			sender_type = EXCLUDED.sender_type,
			summary = EXCLUDED.summary,
			last_seen_at = EXCLUDED.last_seen_at,
			modified_at = NOW()
	`
	count := 0
	for _, p := range profiles {
		slugJSON, _ := json.Marshal(p.SlugCounts)
		labelJSON, _ := json.Marshal(p.LabelCounts)
		kwJSON, _ := json.Marshal(p.KeywordCounts)
		if _, err := tx.ExecContext(ctx, query,
			userID, p.ProfileType, p.Identifier,
			p.EmailCount, p.EmailsArchived, p.EmailsNotified,
			slugJSON, labelJSON, kwJSON,
			p.SenderType, p.Summary,
			p.FirstSeenAt, p.LastSeenAt,
		); err != nil {
			return 0, fmt.Errorf("failed to import sender profile %s: %w", p.Identifier, err)
		}
		count++
	}
	return count, nil
}

func importEmails(ctx context.Context, tx *sql.Tx, userID int64, emails []ExportEmail) (int, error) {
	if len(emails) == 0 {
		return 0, nil
	}
	query := `
		INSERT INTO emails (id, user_id, from_address, from_domain, subject, slug, keywords, summary,
		                     labels_applied, bypassed_inbox, reasoning, human_feedback,
		                     feedback_dirty, notification_sent, processed_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		ON CONFLICT (id)
		DO UPDATE SET
			from_address = EXCLUDED.from_address,
			from_domain = EXCLUDED.from_domain,
			subject = EXCLUDED.subject,
			slug = EXCLUDED.slug,
			keywords = EXCLUDED.keywords,
			summary = EXCLUDED.summary,
			labels_applied = EXCLUDED.labels_applied,
			bypassed_inbox = EXCLUDED.bypassed_inbox,
			reasoning = EXCLUDED.reasoning,
			human_feedback = EXCLUDED.human_feedback,
			feedback_dirty = EXCLUDED.feedback_dirty,
			notification_sent = EXCLUDED.notification_sent
	`
	count := 0
	for _, e := range emails {
		domain := e.FromDomain
		if domain == "" {
			domain = ExtractDomain(e.FromAddress)
		}
		keywordsJSON, _ := json.Marshal(e.Keywords)
		labelsJSON, _ := json.Marshal(e.LabelsApplied)
		if _, err := tx.ExecContext(ctx, query,
			e.ID, userID, e.FromAddress, domain, e.Subject, e.Slug,
			keywordsJSON, e.Summary, labelsJSON,
			e.BypassedInbox, e.Reasoning, e.HumanFeedback,
			e.FeedbackDirty, e.NotificationSent,
			e.ProcessedAt, e.CreatedAt,
		); err != nil {
			return 0, fmt.Errorf("failed to import email %s: %w", e.ID, err)
		}
		count++
	}
	return count, nil
}

func importWrapupReports(ctx context.Context, tx *sql.Tx, userID int64, reports []ExportWrapupReport) (int, error) {
	if len(reports) == 0 {
		return 0, nil
	}
	checkQuery := `
		SELECT EXISTS(
			SELECT 1 FROM wrapup_reports
			WHERE user_id = $1 AND report_type = $2 AND generated_at = $3
		)
	`
	insertQuery := `
		INSERT INTO wrapup_reports (user_id, report_type, content, email_count, generated_at, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
	`
	count := 0
	for _, r := range reports {
		var exists bool
		if err := tx.QueryRowContext(ctx, checkQuery, userID, r.ReportType, r.GeneratedAt).Scan(&exists); err != nil {
			return 0, fmt.Errorf("failed to check wrapup report existence: %w", err)
		}
		if exists {
			continue
		}
		if _, err := tx.ExecContext(ctx, insertQuery, userID, r.ReportType, r.Content, r.EmailCount, r.GeneratedAt); err != nil {
			return 0, fmt.Errorf("failed to import wrapup report: %w", err)
		}
		count++
	}
	return count, nil
}

func importNotifications(ctx context.Context, tx *sql.Tx, userID int64, notifications []ExportNotification) (int, error) {
	if len(notifications) == 0 {
		return 0, nil
	}
	checkQuery := `
		SELECT EXISTS(
			SELECT 1 FROM notifications
			WHERE user_id = $1 AND email_id = $2 AND sent_at = $3
		)
	`
	insertQuery := `
		INSERT INTO notifications (user_id, email_id, from_address, subject, message, sent_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
	`
	count := 0
	for _, n := range notifications {
		var exists bool
		if err := tx.QueryRowContext(ctx, checkQuery, userID, n.EmailID, n.SentAt).Scan(&exists); err != nil {
			return 0, fmt.Errorf("failed to check notification existence: %w", err)
		}
		if exists {
			continue
		}
		if _, err := tx.ExecContext(ctx, insertQuery, userID, n.EmailID, n.FromAddress, n.Subject, n.Message, n.SentAt); err != nil {
			return 0, fmt.Errorf("failed to import notification: %w", err)
		}
		count++
	}
	return count, nil
}

// ImportAllData orchestrates all imports in a single transaction
func (db *DB) ImportAllData(ctx context.Context, userID int64, data ExportData) (*ImportResult, error) {
	tx, err := db.conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback()

	result := &ImportResult{}

	if result.Labels, err = importLabels(ctx, tx, userID, data.Labels); err != nil {
		return nil, err
	}
	if result.SystemPrompts, err = importSystemPrompts(ctx, tx, userID, data.SystemPrompts); err != nil {
		return nil, err
	}
	if result.AIPrompts, err = importAIPrompts(ctx, tx, userID, data.AIPrompts); err != nil {
		return nil, err
	}
	if result.Memories, err = importMemories(ctx, tx, userID, data.Memories); err != nil {
		return nil, err
	}
	if result.SenderProfiles, err = importSenderProfiles(ctx, tx, userID, data.SenderProfiles); err != nil {
		return nil, err
	}
	if result.Emails, err = importEmails(ctx, tx, userID, data.Emails); err != nil {
		return nil, err
	}
	if result.WrapupReports, err = importWrapupReports(ctx, tx, userID, data.WrapupReports); err != nil {
		return nil, err
	}
	if result.Notifications, err = importNotifications(ctx, tx, userID, data.Notifications); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return result, nil
}
