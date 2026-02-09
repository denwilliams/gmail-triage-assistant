package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// CreateMemory creates a new memory entry
func (db *DB) CreateMemory(ctx context.Context, memory *Memory) error {
	query := `
		INSERT INTO memories (user_id, type, content, start_date, end_date, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`

	err := db.conn.QueryRowContext(
		ctx,
		query,
		memory.UserID,
		memory.Type,
		memory.Content,
		memory.StartDate,
		memory.EndDate,
		memory.CreatedAt,
	).Scan(&memory.ID)

	if err != nil {
		return fmt.Errorf("failed to create memory: %w", err)
	}

	return nil
}

// GetMemoriesByType retrieves memories of a specific type for a user
func (db *DB) GetMemoriesByType(ctx context.Context, userID int64, memoryType MemoryType, limit int) ([]*Memory, error) {
	query := `
		SELECT id, user_id, type, content, start_date, end_date, created_at
		FROM memories
		WHERE user_id = $1 AND type = $2
		ORDER BY start_date DESC
		LIMIT $3
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, memoryType, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var memory Memory
		err := rows.Scan(
			&memory.ID,
			&memory.UserID,
			&memory.Type,
			&memory.Content,
			&memory.StartDate,
			&memory.EndDate,
			&memory.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		memories = append(memories, &memory)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating memories: %w", err)
	}

	return memories, nil
}

// GetAllMemories retrieves all memories for a user
func (db *DB) GetAllMemories(ctx context.Context, userID int64, limit int) ([]*Memory, error) {
	query := `
		SELECT id, user_id, type, content, start_date, end_date, created_at
		FROM memories
		WHERE user_id = $1
		ORDER BY start_date DESC
		LIMIT $2
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var memory Memory
		err := rows.Scan(
			&memory.ID,
			&memory.UserID,
			&memory.Type,
			&memory.Content,
			&memory.StartDate,
			&memory.EndDate,
			&memory.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		memories = append(memories, &memory)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating memories: %w", err)
	}

	return memories, nil
}

// GetRecentMemoriesForContext retrieves the most relevant memories for AI context
// Returns: 1 yearly, 1 monthly, 1 weekly, and up to 7 daily memories
func (db *DB) GetRecentMemoriesForContext(ctx context.Context, userID int64) ([]*Memory, error) {
	query := `
		(
			SELECT id, user_id, type, content, start_date, end_date, created_at
			FROM memories
			WHERE user_id = $1 AND type = 'yearly'
			ORDER BY start_date DESC
			LIMIT 1
		)
		UNION ALL
		(
			SELECT id, user_id, type, content, start_date, end_date, created_at
			FROM memories
			WHERE user_id = $1 AND type = 'monthly'
			ORDER BY start_date DESC
			LIMIT 1
		)
		UNION ALL
		(
			SELECT id, user_id, type, content, start_date, end_date, created_at
			FROM memories
			WHERE user_id = $1 AND type = 'weekly'
			ORDER BY start_date DESC
			LIMIT 1
		)
		UNION ALL
		(
			SELECT id, user_id, type, content, start_date, end_date, created_at
			FROM memories
			WHERE user_id = $1 AND type = 'daily'
			ORDER BY start_date DESC
			LIMIT 7
		)
		ORDER BY
			CASE type
				WHEN 'yearly' THEN 1
				WHEN 'monthly' THEN 2
				WHEN 'weekly' THEN 3
				WHEN 'daily' THEN 4
			END,
			start_date DESC
	`

	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query memories for context: %w", err)
	}
	defer rows.Close()

	var memories []*Memory
	for rows.Next() {
		var memory Memory
		err := rows.Scan(
			&memory.ID,
			&memory.UserID,
			&memory.Type,
			&memory.Content,
			&memory.StartDate,
			&memory.EndDate,
			&memory.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan memory: %w", err)
		}
		memories = append(memories, &memory)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating memories: %w", err)
	}

	return memories, nil
}

// GetEmailsByDateRange retrieves emails processed within a date range
func (db *DB) GetEmailsByDateRange(ctx context.Context, userID int64, startDate, endDate time.Time) ([]*Email, error) {
	query := `
		SELECT id, user_id, from_address, subject, slug, keywords, summary,
		       labels_applied, bypassed_inbox, processed_at, created_at
		FROM emails
		WHERE user_id = $1 AND processed_at >= $2 AND processed_at < $3
		ORDER BY processed_at ASC
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to query emails by date range: %w", err)
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
