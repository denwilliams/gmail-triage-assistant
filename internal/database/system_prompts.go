package database

import (
	"context"
	"fmt"
	"time"
)

// GetSystemPrompt retrieves a system prompt by user and type
func (db *DB) GetSystemPrompt(ctx context.Context, userID int64, promptType PromptType) (*SystemPrompt, error) {
	query := `
		SELECT id, user_id, type, content, created_at, updated_at
		FROM system_prompts
		WHERE user_id = $1 AND type = $2
	`

	var prompt SystemPrompt
	err := db.conn.QueryRowContext(ctx, query, userID, promptType).Scan(
		&prompt.ID,
		&prompt.UserID,
		&prompt.Type,
		&prompt.Content,
		&prompt.CreatedAt,
		&prompt.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get system prompt: %w", err)
	}

	return &prompt, nil
}

// GetAllSystemPrompts retrieves all system prompts for a user
func (db *DB) GetAllSystemPrompts(ctx context.Context, userID int64) ([]*SystemPrompt, error) {
	query := `
		SELECT id, user_id, type, content, created_at, updated_at
		FROM system_prompts
		WHERE user_id = $1
		ORDER BY type
	`

	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query system prompts: %w", err)
	}
	defer rows.Close()

	var prompts []*SystemPrompt
	for rows.Next() {
		var prompt SystemPrompt
		err := rows.Scan(
			&prompt.ID,
			&prompt.UserID,
			&prompt.Type,
			&prompt.Content,
			&prompt.CreatedAt,
			&prompt.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan system prompt: %w", err)
		}
		prompts = append(prompts, &prompt)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating system prompts: %w", err)
	}

	return prompts, nil
}

// UpsertSystemPrompt creates or updates a system prompt
func (db *DB) UpsertSystemPrompt(ctx context.Context, prompt *SystemPrompt) error {
	query := `
		INSERT INTO system_prompts (user_id, type, content, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, type)
		DO UPDATE SET content = $3, updated_at = $5
		RETURNING id
	`

	now := time.Now()
	err := db.conn.QueryRowContext(
		ctx,
		query,
		prompt.UserID,
		prompt.Type,
		prompt.Content,
		now,
		now,
	).Scan(&prompt.ID)

	if err != nil {
		return fmt.Errorf("failed to upsert system prompt: %w", err)
	}

	return nil
}

// InitializeDefaultPrompts creates default prompts for a user if they don't exist
func (db *DB) InitializeDefaultPrompts(ctx context.Context, userID int64) error {
	defaultPrompts := map[PromptType]string{
		PromptTypeEmailAnalyze: `You are an AI email analyst. Analyze the email and provide:
1. A short slug (2-4 words) categorizing the sender/topic
2. 3-5 keywords describing the content
3. A one-sentence summary

Be consistent with slugs - reuse existing slugs when appropriate.`,

		PromptTypeEmailActions: `You are an AI email manager. Based on the email analysis and available labels, decide:
1. Which labels to apply (choose from the provided list)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decision

Only apply labels that accurately match the email content.`,
	}

	for promptType, content := range defaultPrompts {
		prompt := &SystemPrompt{
			UserID:  userID,
			Type:    promptType,
			Content: content,
		}
		if err := db.UpsertSystemPrompt(ctx, prompt); err != nil {
			return fmt.Errorf("failed to initialize default prompt %s: %w", promptType, err)
		}
	}

	return nil
}
