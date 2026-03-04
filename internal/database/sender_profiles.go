package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// GetSenderProfile returns a profile by type and identifier, or nil if not found
func (db *DB) GetSenderProfile(ctx context.Context, userID int64, profileType ProfileType, identifier string) (*SenderProfile, error) {
	query := `
		SELECT id, user_id, profile_type, identifier,
		       email_count, emails_archived, emails_notified,
		       slug_counts, label_counts, keyword_counts,
		       sender_type, summary,
		       first_seen_at, last_seen_at, modified_at, created_at
		FROM sender_profiles
		WHERE user_id = $1 AND profile_type = $2 AND identifier = $3
	`

	var p SenderProfile
	var slugCountsJSON, labelCountsJSON, keywordCountsJSON []byte

	err := db.conn.QueryRowContext(ctx, query, userID, profileType, identifier).Scan(
		&p.ID, &p.UserID, &p.ProfileType, &p.Identifier,
		&p.EmailCount, &p.EmailsArchived, &p.EmailsNotified,
		&slugCountsJSON, &labelCountsJSON, &keywordCountsJSON,
		&p.SenderType, &p.Summary,
		&p.FirstSeenAt, &p.LastSeenAt, &p.ModifiedAt, &p.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get sender profile: %w", err)
	}

	p.SlugCounts = make(map[string]int)
	p.LabelCounts = make(map[string]int)
	p.KeywordCounts = make(map[string]int)

	if err := json.Unmarshal(slugCountsJSON, &p.SlugCounts); err != nil {
		return nil, fmt.Errorf("failed to unmarshal slug_counts: %w", err)
	}
	if err := json.Unmarshal(labelCountsJSON, &p.LabelCounts); err != nil {
		return nil, fmt.Errorf("failed to unmarshal label_counts: %w", err)
	}
	if err := json.Unmarshal(keywordCountsJSON, &p.KeywordCounts); err != nil {
		return nil, fmt.Errorf("failed to unmarshal keyword_counts: %w", err)
	}

	return &p, nil
}

// UpsertSenderProfile creates or updates a sender profile
func (db *DB) UpsertSenderProfile(ctx context.Context, profile *SenderProfile) error {
	slugCountsJSON, err := json.Marshal(profile.SlugCounts)
	if err != nil {
		return fmt.Errorf("failed to marshal slug_counts: %w", err)
	}
	labelCountsJSON, err := json.Marshal(profile.LabelCounts)
	if err != nil {
		return fmt.Errorf("failed to marshal label_counts: %w", err)
	}
	keywordCountsJSON, err := json.Marshal(profile.KeywordCounts)
	if err != nil {
		return fmt.Errorf("failed to marshal keyword_counts: %w", err)
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

	_, err = db.conn.ExecContext(ctx, query,
		profile.UserID, profile.ProfileType, profile.Identifier,
		profile.EmailCount, profile.EmailsArchived, profile.EmailsNotified,
		slugCountsJSON, labelCountsJSON, keywordCountsJSON,
		profile.SenderType, profile.Summary,
		profile.FirstSeenAt, profile.LastSeenAt,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert sender profile: %w", err)
	}

	return nil
}

// DeleteStaleProfiles removes profiles not modified in over 1 year
func (db *DB) DeleteStaleProfiles(ctx context.Context) (int64, error) {
	query := `DELETE FROM sender_profiles WHERE modified_at < NOW() - INTERVAL '1 year'`

	result, err := db.conn.ExecContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("failed to delete stale profiles: %w", err)
	}

	return result.RowsAffected()
}

// GetHistoricalEmailsFromAddress returns the last N emails from a specific address
func (db *DB) GetHistoricalEmailsFromAddress(ctx context.Context, userID int64, address string, limit int) ([]*Email, error) {
	query := `
		SELECT id, user_id, from_address, subject, slug, keywords, summary,
		       labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, ''), notification_sent, processed_at, created_at
		FROM emails
		WHERE user_id = $1 AND from_address = $2
		ORDER BY processed_at DESC
		LIMIT $3
	`
	return db.scanEmails(ctx, query, userID, address, limit)
}

// GetHistoricalEmailsFromDomain returns the last N emails from any address at a domain
func (db *DB) GetHistoricalEmailsFromDomain(ctx context.Context, userID int64, domain string, limit int) ([]*Email, error) {
	query := `
		SELECT id, user_id, from_address, subject, slug, keywords, summary,
		       labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, ''), notification_sent, processed_at, created_at
		FROM emails
		WHERE user_id = $1 AND from_address LIKE '%@' || $2
		ORDER BY processed_at DESC
		LIMIT $3
	`
	return db.scanEmails(ctx, query, userID, domain, limit)
}

// scanEmails is a shared helper to scan email rows
func (db *DB) scanEmails(ctx context.Context, query string, args ...interface{}) ([]*Email, error) {
	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query emails: %w", err)
	}
	defer rows.Close()

	var emails []*Email
	for rows.Next() {
		var email Email
		var keywordsJSON, labelsJSON []byte

		err := rows.Scan(
			&email.ID, &email.UserID, &email.FromAddress, &email.Subject,
			&email.Slug, &keywordsJSON, &email.Summary,
			&labelsJSON, &email.BypassedInbox, &email.Reasoning,
			&email.HumanFeedback, &email.NotificationSent,
			&email.ProcessedAt, &email.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan email: %w", err)
		}

		if err := json.Unmarshal(keywordsJSON, &email.Keywords); err != nil {
			email.Keywords = []string{}
		}
		if err := json.Unmarshal(labelsJSON, &email.LabelsApplied); err != nil {
			email.LabelsApplied = []string{}
		}

		emails = append(emails, &email)
	}

	return emails, rows.Err()
}

// BuildProfileFromEmails computes counters from historical emails for bootstrapping
func BuildProfileFromEmails(userID int64, profileType ProfileType, identifier string, emails []*Email) *SenderProfile {
	profile := &SenderProfile{
		UserID:        userID,
		ProfileType:   profileType,
		Identifier:    identifier,
		EmailCount:    len(emails),
		SlugCounts:    make(map[string]int),
		LabelCounts:   make(map[string]int),
		KeywordCounts: make(map[string]int),
		FirstSeenAt:   time.Now(),
		LastSeenAt:    time.Now(),
	}

	for _, e := range emails {
		if e.Slug != "" {
			profile.SlugCounts[e.Slug]++
		}
		for _, label := range e.LabelsApplied {
			profile.LabelCounts[label]++
		}
		for _, kw := range e.Keywords {
			profile.KeywordCounts[kw]++
		}
		if e.BypassedInbox {
			profile.EmailsArchived++
		}
		if e.NotificationSent {
			profile.EmailsNotified++
		}
		if e.ProcessedAt.Before(profile.FirstSeenAt) {
			profile.FirstSeenAt = e.ProcessedAt
		}
		if e.ProcessedAt.After(profile.LastSeenAt) {
			profile.LastSeenAt = e.ProcessedAt
		}
	}

	return profile
}
