package database

import (
	"context"
	"time"
)

// Notification represents a push notification sent to the user
type Notification struct {
	ID          int64     `db:"id" json:"id"`
	UserID      int64     `db:"user_id" json:"user_id"`
	EmailID     string    `db:"email_id" json:"email_id"`
	FromAddress string    `db:"from_address" json:"from_address"`
	Subject     string    `db:"subject" json:"subject"`
	Message     string    `db:"message" json:"message"`
	SentAt      time.Time `db:"sent_at" json:"sent_at"`
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
}

// CreateNotification saves a new notification to the database
func (db *DB) CreateNotification(ctx context.Context, notification *Notification) error {
	query := `
		INSERT INTO notifications (user_id, email_id, from_address, subject, message, sent_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		RETURNING id, created_at
	`

	err := db.conn.QueryRowContext(
		ctx,
		query,
		notification.UserID,
		notification.EmailID,
		notification.FromAddress,
		notification.Subject,
		notification.Message,
		notification.SentAt,
	).Scan(&notification.ID, &notification.CreatedAt)

	return err
}

// GetNotificationsByUser retrieves notifications for a user, ordered by sent_at (most recent first)
func (db *DB) GetNotificationsByUser(ctx context.Context, userID int64, limit int) ([]*Notification, error) {
	query := `
		SELECT id, user_id, email_id, from_address, subject, message, sent_at, created_at
		FROM notifications
		WHERE user_id = $1
		ORDER BY sent_at DESC
		LIMIT $2
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifications []*Notification
	for rows.Next() {
		var n Notification
		err := rows.Scan(
			&n.ID,
			&n.UserID,
			&n.EmailID,
			&n.FromAddress,
			&n.Subject,
			&n.Message,
			&n.SentAt,
			&n.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		notifications = append(notifications, &n)
	}

	return notifications, rows.Err()
}
