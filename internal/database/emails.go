package database

import (
	"context"
	"encoding/json"
	"fmt"
)

// CreateEmail saves email analysis results to the database
func (db *DB) CreateEmail(ctx context.Context, email *Email) error {
	// Convert slices to JSON for PostgreSQL JSONB
	keywordsJSON, err := json.Marshal(email.Keywords)
	if err != nil {
		return fmt.Errorf("failed to marshal keywords: %w", err)
	}

	labelsJSON, err := json.Marshal(email.LabelsApplied)
	if err != nil {
		return fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		INSERT INTO emails (id, user_id, from_address, subject, slug, keywords, summary, labels_applied, bypassed_inbox, processed_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		ON CONFLICT (id) DO NOTHING
	`

	_, err = db.conn.ExecContext(
		ctx,
		query,
		email.ID,
		email.UserID,
		email.FromAddress,
		email.Subject,
		email.Slug,
		keywordsJSON,
		email.Summary,
		labelsJSON,
		email.BypassedInbox,
		email.ProcessedAt,
		email.CreatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create email: %w", err)
	}

	return nil
}

// GetPastSlugsFromSender retrieves past slugs used for emails from a specific sender
func (db *DB) GetPastSlugsFromSender(ctx context.Context, userID int64, fromAddress string, limit int) ([]string, error) {
	query := `
		SELECT DISTINCT slug
		FROM emails
		WHERE user_id = $1 AND from_address = $2
		ORDER BY slug
		LIMIT $3
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, fromAddress, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query past slugs: %w", err)
	}
	defer rows.Close()

	var slugs []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, fmt.Errorf("failed to scan slug: %w", err)
		}
		slugs = append(slugs, slug)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating slugs: %w", err)
	}

	return slugs, nil
}

// GetUserLabels retrieves all label names for a user
func (db *DB) GetUserLabels(ctx context.Context, userID int64) ([]string, error) {
	query := `
		SELECT name
		FROM labels
		WHERE user_id = $1
		ORDER BY name
	`

	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query user labels: %w", err)
	}
	defer rows.Close()

	var labels []string
	for rows.Next() {
		var label string
		if err := rows.Scan(&label); err != nil {
			return nil, fmt.Errorf("failed to scan label: %w", err)
		}
		labels = append(labels, label)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating labels: %w", err)
	}

	return labels, nil
}

// GetRecentEmails retrieves recent processed emails for a user
func (db *DB) GetRecentEmails(ctx context.Context, userID int64, limit int) ([]*Email, error) {
	query := `
		SELECT id, user_id, from_address, subject, slug, keywords, summary,
		       labels_applied, bypassed_inbox, processed_at, created_at
		FROM emails
		WHERE user_id = $1
		ORDER BY processed_at DESC
		LIMIT $2
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query recent emails: %w", err)
	}
	defer rows.Close()

	var emails []*Email
	for rows.Next() {
		var email Email
		var keywordsJSON, labelsJSON []byte

		err := rows.Scan(
			&email.ID,
			&email.UserID,
			&email.FromAddress,
			&email.Subject,
			&email.Slug,
			&keywordsJSON,
			&email.Summary,
			&labelsJSON,
			&email.BypassedInbox,
			&email.ProcessedAt,
			&email.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan email: %w", err)
		}

		// Unmarshal JSON arrays
		if err := json.Unmarshal(keywordsJSON, &email.Keywords); err != nil {
			return nil, fmt.Errorf("failed to unmarshal keywords: %w", err)
		}
		if err := json.Unmarshal(labelsJSON, &email.LabelsApplied); err != nil {
			return nil, fmt.Errorf("failed to unmarshal labels: %w", err)
		}

		emails = append(emails, &email)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating emails: %w", err)
	}

	return emails, nil
}
