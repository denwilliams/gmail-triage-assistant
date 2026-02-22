package database

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/oauth2"
)

// CreateUser creates a new user with OAuth tokens
func (db *DB) CreateUser(ctx context.Context, email, googleID string, token *oauth2.Token) (*User, error) {
	user := &User{
		Email:        email,
		GoogleID:     googleID,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		TokenExpiry:  token.Expiry,
		IsActive:     true,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	query := `
		INSERT INTO users (email, google_id, access_token, refresh_token, token_expiry, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`

	err := db.conn.QueryRowContext(
		ctx,
		query,
		user.Email,
		user.GoogleID,
		user.AccessToken,
		user.RefreshToken,
		user.TokenExpiry,
		user.IsActive,
		user.CreatedAt,
		user.UpdatedAt,
	).Scan(&user.ID)

	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return user, nil
}

// GetUserByEmail retrieves a user by email
func (db *DB) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	user := &User{}

	query := `
		SELECT id, email, google_id, access_token, refresh_token, token_expiry, is_active, last_checked_at, gmail_history_id, created_at, updated_at
		FROM users
		WHERE email = $1
	`

	err := db.conn.QueryRowContext(ctx, query, email).Scan(
		&user.ID,
		&user.Email,
		&user.GoogleID,
		&user.AccessToken,
		&user.RefreshToken,
		&user.TokenExpiry,
		&user.IsActive,
		&user.LastCheckedAt,
		&user.GmailHistoryID,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get user by email: %w", err)
	}

	return user, nil
}

// GetUserByGoogleID retrieves a user by Google ID
func (db *DB) GetUserByGoogleID(ctx context.Context, googleID string) (*User, error) {
	user := &User{}

	query := `
		SELECT id, email, google_id, access_token, refresh_token, token_expiry, is_active, last_checked_at, gmail_history_id, created_at, updated_at
		FROM users
		WHERE google_id = $1
	`

	err := db.conn.QueryRowContext(ctx, query, googleID).Scan(
		&user.ID,
		&user.Email,
		&user.GoogleID,
		&user.AccessToken,
		&user.RefreshToken,
		&user.TokenExpiry,
		&user.IsActive,
		&user.LastCheckedAt,
		&user.GmailHistoryID,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to get user by google ID: %w", err)
	}

	return user, nil
}

// UpdateUserToken updates a user's OAuth token
func (db *DB) UpdateUserToken(ctx context.Context, userID int64, token *oauth2.Token) error {
	query := `
		UPDATE users
		SET access_token = $1, refresh_token = $2, token_expiry = $3, updated_at = $4
		WHERE id = $5
	`

	_, err := db.conn.ExecContext(
		ctx,
		query,
		token.AccessToken,
		token.RefreshToken,
		token.Expiry,
		time.Now(),
		userID,
	)

	if err != nil {
		return fmt.Errorf("failed to update user token: %w", err)
	}

	return nil
}

// UpdateLastCheckedAt updates the last_checked_at timestamp for a user
func (db *DB) UpdateLastCheckedAt(ctx context.Context, userID int64, checkedAt time.Time) error {
	query := `
		UPDATE users
		SET last_checked_at = $1, updated_at = $2
		WHERE id = $3
	`

	_, err := db.conn.ExecContext(ctx, query, checkedAt, time.Now(), userID)
	if err != nil {
		return fmt.Errorf("failed to update last_checked_at: %w", err)
	}

	return nil
}

// SetUserActive sets the active status of a user
func (db *DB) SetUserActive(ctx context.Context, userID int64, isActive bool) error {
	query := `
		UPDATE users
		SET is_active = $1, updated_at = $2
		WHERE id = $3
	`

	_, err := db.conn.ExecContext(ctx, query, isActive, time.Now(), userID)
	if err != nil {
		return fmt.Errorf("failed to set user active status: %w", err)
	}

	return nil
}

// GetOAuth2Token converts User tokens to oauth2.Token
func (u *User) GetOAuth2Token() *oauth2.Token {
	return &oauth2.Token{
		AccessToken:  u.AccessToken,
		RefreshToken: u.RefreshToken,
		Expiry:       u.TokenExpiry,
		TokenType:    "Bearer",
	}
}

// UpdateGmailHistoryID updates the gmail_history_id for a user
func (db *DB) UpdateGmailHistoryID(ctx context.Context, userID int64, historyID int64) error {
	query := `
		UPDATE users
		SET gmail_history_id = $1, updated_at = $2
		WHERE id = $3
	`
	_, err := db.conn.ExecContext(ctx, query, historyID, time.Now(), userID)
	if err != nil {
		return fmt.Errorf("failed to update gmail_history_id: %w", err)
	}
	return nil
}

// GetActiveUsers retrieves all users where is_active = true, ordered by email.
// Use this for all scheduler tasks, polling monitors, and watch renewal.
func (db *DB) GetActiveUsers(ctx context.Context) ([]*User, error) {
	query := `
		SELECT id, email, google_id, access_token, refresh_token, token_expiry, is_active, last_checked_at, gmail_history_id, created_at, updated_at
		FROM users
		WHERE is_active = true
		ORDER BY email
	`

	rows, err := db.conn.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to query active users: %w", err)
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		var user User
		err := rows.Scan(
			&user.ID,
			&user.Email,
			&user.GoogleID,
			&user.AccessToken,
			&user.RefreshToken,
			&user.TokenExpiry,
			&user.IsActive,
			&user.LastCheckedAt,
			&user.GmailHistoryID,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan user: %w", err)
		}
		users = append(users, &user)
	}

	return users, rows.Err()
}
