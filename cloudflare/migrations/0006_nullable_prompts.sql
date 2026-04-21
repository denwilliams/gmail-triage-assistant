-- Make system_prompts.content nullable to distinguish "not set" from "empty"
-- Add new bucket-specific prompt types to the CHECK constraint

-- Recreate the table with nullable content and updated type constraint
CREATE TABLE IF NOT EXISTS system_prompts_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN (
        'email_analyze',
        'email_actions',
        'daily_review',
        'weekly_summary',
        'monthly_summary',
        'yearly_summary',
        'wrapup_report',
        'bucket_triage',
        'bucket_newsletter',
        'bucket_notification',
        'bucket_human',
        'bucket_transactional',
        'bucket_security',
        'bucket_calendar'
    )),
    content TEXT,
    is_active INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, type)
);

-- Copy data from old table
INSERT INTO system_prompts_new (id, user_id, type, content, is_active, description, created_at, updated_at)
SELECT id, user_id, type, content, is_active, description, created_at, updated_at FROM system_prompts;

-- Drop old table and rename
DROP TABLE system_prompts;
ALTER TABLE system_prompts_new RENAME TO system_prompts;
