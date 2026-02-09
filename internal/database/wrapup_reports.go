package database

import (
	"context"
	"time"
)

// WrapupReport represents a generated wrapup report
type WrapupReport struct {
	ID          int64
	UserID      int64
	ReportType  string // "morning" or "evening"
	Content     string
	EmailCount  int
	GeneratedAt time.Time
	CreatedAt   time.Time
}

// CreateWrapupReport saves a new wrapup report to the database
func (db *DB) CreateWrapupReport(ctx context.Context, report *WrapupReport) error {
	query := `
		INSERT INTO wrapup_reports (user_id, report_type, content, email_count, generated_at, created_at)
		VALUES ($1, $2, $3, $4, $5, NOW())
		RETURNING id, created_at
	`

	err := db.conn.QueryRowContext(
		ctx,
		query,
		report.UserID,
		report.ReportType,
		report.Content,
		report.EmailCount,
		report.GeneratedAt,
	).Scan(&report.ID, &report.CreatedAt)

	return err
}

// GetWrapupReportsByUser retrieves all wrapup reports for a user, ordered by time (most recent first)
func (db *DB) GetWrapupReportsByUser(ctx context.Context, userID int64, limit int) ([]*WrapupReport, error) {
	query := `
		SELECT id, user_id, report_type, content, email_count, generated_at, created_at
		FROM wrapup_reports
		WHERE user_id = $1
		ORDER BY generated_at DESC
		LIMIT $2
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reports []*WrapupReport
	for rows.Next() {
		var report WrapupReport
		err := rows.Scan(
			&report.ID,
			&report.UserID,
			&report.ReportType,
			&report.Content,
			&report.EmailCount,
			&report.GeneratedAt,
			&report.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		reports = append(reports, &report)
	}

	return reports, rows.Err()
}

// GetWrapupReportsByType retrieves wrapup reports for a user filtered by type
func (db *DB) GetWrapupReportsByType(ctx context.Context, userID int64, reportType string, limit int) ([]*WrapupReport, error) {
	query := `
		SELECT id, user_id, report_type, content, email_count, generated_at, created_at
		FROM wrapup_reports
		WHERE user_id = $1 AND report_type = $2
		ORDER BY generated_at DESC
		LIMIT $3
	`

	rows, err := db.conn.QueryContext(ctx, query, userID, reportType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var reports []*WrapupReport
	for rows.Next() {
		var report WrapupReport
		err := rows.Scan(
			&report.ID,
			&report.UserID,
			&report.ReportType,
			&report.Content,
			&report.EmailCount,
			&report.GeneratedAt,
			&report.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		reports = append(reports, &report)
	}

	return reports, rows.Err()
}
