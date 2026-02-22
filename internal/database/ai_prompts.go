package database

import (
	"context"
	"database/sql"
	"fmt"
)

// GetLatestAIPrompt retrieves the most recent AI prompt of a given type for a user.
// Returns nil, nil if no AI prompt exists yet.
func (db *DB) GetLatestAIPrompt(ctx context.Context, userID int64, promptType AIPromptType) (*AIPrompt, error) {
	query := `
		SELECT id, user_id, type, content, version, created_at
		FROM ai_prompts
		WHERE user_id = $1 AND type = $2
		ORDER BY version DESC
		LIMIT 1
	`

	var prompt AIPrompt
	err := db.conn.QueryRowContext(ctx, query, userID, promptType).Scan(
		&prompt.ID,
		&prompt.UserID,
		&prompt.Type,
		&prompt.Content,
		&prompt.Version,
		&prompt.CreatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get latest AI prompt: %w", err)
	}

	return &prompt, nil
}

// CreateAIPrompt inserts a new AI prompt version. It auto-increments the version
// based on the current max version for this user+type.
func (db *DB) CreateAIPrompt(ctx context.Context, prompt *AIPrompt) error {
	query := `
		INSERT INTO ai_prompts (user_id, type, content, version, created_at)
		VALUES ($1, $2, $3, COALESCE((
			SELECT MAX(version) FROM ai_prompts WHERE user_id = $1 AND type = $2
		), 0) + 1, NOW())
		RETURNING id, version
	`

	err := db.conn.QueryRowContext(
		ctx,
		query,
		prompt.UserID,
		prompt.Type,
		prompt.Content,
	).Scan(&prompt.ID, &prompt.Version)

	if err != nil {
		return fmt.Errorf("failed to create AI prompt: %w", err)
	}

	return nil
}

// GetAIPromptHistory retrieves all versions of an AI prompt type for a user, newest first.
func (db *DB) GetAIPromptHistory(ctx context.Context, userID int64, promptType AIPromptType, limit int) ([]*AIPrompt, error) {
	query := `
		SELECT id, user_id, type, content, version, created_at
		FROM ai_prompts
		WHERE user_id = $1 AND type = $2
		ORDER BY version DESC
		LIMIT $3
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, promptType, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to query AI prompt history: %w", err)
	}
	defer rows.Close()

	var prompts []*AIPrompt
	for rows.Next() {
		var p AIPrompt
		err := rows.Scan(&p.ID, &p.UserID, &p.Type, &p.Content, &p.Version, &p.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan AI prompt: %w", err)
		}
		prompts = append(prompts, &p)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating AI prompt history: %w", err)
	}

	return prompts, nil
}
