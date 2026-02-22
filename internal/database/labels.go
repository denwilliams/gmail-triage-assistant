package database

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// CreateLabel creates a new label for a user
func (db *DB) CreateLabel(ctx context.Context, label *Label) error {
	// Convert reasons slice to JSON
	reasonsJSON, err := json.Marshal(label.Reasons)
	if err != nil {
		return fmt.Errorf("failed to marshal reasons: %w", err)
	}

	query := `
		INSERT INTO labels (user_id, name, reasons, description, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`

	err = db.conn.QueryRowContext(
		ctx,
		query,
		label.UserID,
		label.Name,
		reasonsJSON,
		label.Description,
		time.Now(),
		time.Now(),
	).Scan(&label.ID)

	if err != nil {
		return fmt.Errorf("failed to create label: %w", err)
	}

	return nil
}

// GetAllLabels retrieves all labels for a user
func (db *DB) GetAllLabels(ctx context.Context, userID int64) ([]*Label, error) {
	query := `
		SELECT id, user_id, name, reasons, description, created_at, updated_at
		FROM labels
		WHERE user_id = $1
		ORDER BY name
	`

	rows, err := db.conn.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query labels: %w", err)
	}
	defer rows.Close()

	var labels []*Label
	for rows.Next() {
		var label Label
		var reasonsJSON []byte

		err := rows.Scan(
			&label.ID,
			&label.UserID,
			&label.Name,
			&reasonsJSON,
			&label.Description,
			&label.CreatedAt,
			&label.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan label: %w", err)
		}

		// Unmarshal reasons JSON
		if err := json.Unmarshal(reasonsJSON, &label.Reasons); err != nil {
			return nil, fmt.Errorf("failed to unmarshal reasons: %w", err)
		}

		labels = append(labels, &label)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating labels: %w", err)
	}

	return labels, nil
}

// UpdateLabel updates a label's name, description, and reasons
func (db *DB) UpdateLabel(ctx context.Context, label *Label) error {
	reasonsJSON, err := json.Marshal(label.Reasons)
	if err != nil {
		return fmt.Errorf("failed to marshal reasons: %w", err)
	}

	query := `
		UPDATE labels SET name = $1, description = $2, reasons = $3, updated_at = $4
		WHERE id = $5 AND user_id = $6
	`

	result, err := db.conn.ExecContext(ctx, query, label.Name, label.Description, reasonsJSON, time.Now(), label.ID, label.UserID)
	if err != nil {
		return fmt.Errorf("failed to update label: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("label not found or not owned by user")
	}

	return nil
}

// DeleteLabel deletes a label for a user
func (db *DB) DeleteLabel(ctx context.Context, userID int64, labelID string) error {
	query := `DELETE FROM labels WHERE id = $1 AND user_id = $2`

	result, err := db.conn.ExecContext(ctx, query, labelID, userID)
	if err != nil {
		return fmt.Errorf("failed to delete label: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("label not found or not owned by user")
	}

	return nil
}
