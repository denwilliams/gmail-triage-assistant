-- Create wrapup_reports table
CREATE TABLE IF NOT EXISTS wrapup_reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_type VARCHAR(20) NOT NULL CHECK (report_type IN ('morning', 'evening')),
    content TEXT NOT NULL,
    email_count INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups by user and date
CREATE INDEX idx_wrapup_reports_user_generated ON wrapup_reports(user_id, generated_at DESC);
CREATE INDEX idx_wrapup_reports_type ON wrapup_reports(user_id, report_type, generated_at DESC);
