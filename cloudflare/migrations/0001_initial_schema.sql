-- Consolidated D1 schema for Gmail Triage Assistant
-- Converted from PostgreSQL migrations 001-016

-- ============================================================================
-- Users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    google_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT DEFAULT (datetime('now')),
    pushover_user_key TEXT DEFAULT '',
    pushover_app_token TEXT DEFAULT '',
    webhook_url TEXT DEFAULT '',
    webhook_header_key TEXT DEFAULT '',
    webhook_header_value TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- ============================================================================
-- Emails
-- ============================================================================
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    from_address TEXT NOT NULL,
    from_domain TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    slug TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    labels_applied TEXT NOT NULL DEFAULT '[]',
    bypassed_inbox INTEGER NOT NULL DEFAULT 0,
    reasoning TEXT NOT NULL DEFAULT '',
    human_feedback TEXT DEFAULT '',
    feedback_dirty INTEGER DEFAULT 0,
    notification_sent INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_from_address ON emails(user_id, from_address);
CREATE INDEX IF NOT EXISTS idx_emails_slug ON emails(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_emails_processed_at ON emails(user_id, processed_at);
CREATE INDEX IF NOT EXISTS idx_emails_from_domain ON emails(from_domain);
CREATE INDEX IF NOT EXISTS idx_emails_human_feedback ON emails(user_id, human_feedback);
CREATE INDEX IF NOT EXISTS idx_emails_feedback_dirty ON emails(user_id, feedback_dirty);

-- ============================================================================
-- Labels
-- ============================================================================
CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

-- ============================================================================
-- System Prompts
-- ============================================================================
CREATE TABLE IF NOT EXISTS system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN (
        'email_analyze',
        'email_actions',
        'daily_review',
        'weekly_summary',
        'monthly_summary',
        'yearly_summary',
        'wrapup_report'
    )),
    content TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, type)
);

-- ============================================================================
-- AI Prompts
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('email_analyze', 'email_actions')),
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_prompts_user_type_version ON ai_prompts(user_id, type, version);

-- ============================================================================
-- Memories
-- ============================================================================
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('daily', 'weekly', 'monthly', 'yearly')),
    content TEXT NOT NULL,
    reasoning TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_dates ON memories(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_memories_user_type_start ON memories(user_id, type, start_date);

-- ============================================================================
-- Sender Profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS sender_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL CHECK (profile_type IN ('sender', 'domain')),
    identifier TEXT NOT NULL,
    email_count INTEGER NOT NULL DEFAULT 0,
    emails_archived INTEGER NOT NULL DEFAULT 0,
    emails_notified INTEGER NOT NULL DEFAULT 0,
    slug_counts TEXT NOT NULL DEFAULT '{}',
    label_counts TEXT NOT NULL DEFAULT '{}',
    keyword_counts TEXT NOT NULL DEFAULT '{}',
    sender_type TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, profile_type, identifier)
);

CREATE INDEX IF NOT EXISTS idx_sender_profiles_stale ON sender_profiles(modified_at);

-- ============================================================================
-- Wrapup Reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS wrapup_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL CHECK (report_type IN ('morning', 'evening')),
    content TEXT NOT NULL,
    email_count INTEGER NOT NULL DEFAULT 0,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wrapup_reports_user_generated ON wrapup_reports(user_id, generated_at);
CREATE INDEX IF NOT EXISTS idx_wrapup_reports_type ON wrapup_reports(user_id, report_type, generated_at);

-- ============================================================================
-- Notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_sent ON notifications(user_id, sent_at);
