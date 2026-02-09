-- Initial database schema for Gmail Triage Assistant (PostgreSQL)

-- Emails table: stores analysis results for each processed email
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,                    -- Gmail message ID
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    slug TEXT NOT NULL,
    keywords JSONB NOT NULL,                -- Native JSON array
    summary TEXT NOT NULL,
    labels_applied JSONB NOT NULL,          -- Native JSON array
    bypassed_inbox BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_emails_from_address ON emails(from_address);
CREATE INDEX idx_emails_slug ON emails(slug);
CREATE INDEX idx_emails_processed_at ON emails(processed_at);
CREATE INDEX idx_emails_keywords ON emails USING GIN(keywords);
CREATE INDEX idx_emails_labels ON emails USING GIN(labels_applied);

-- Labels table: Gmail labels with configuration
CREATE TABLE IF NOT EXISTS labels (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    reasons JSONB NOT NULL,                 -- Native JSON array
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- System prompts table: configurable AI prompts for different operations
CREATE TABLE IF NOT EXISTS system_prompts (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN (
        'email_analyze',     -- Content analysis: slug, keywords, summary
        'email_actions',     -- Action generation: labels, inbox bypass
        'daily_review',      -- Daily decision review (5PM)
        'weekly_summary',    -- Weekly memory consolidation
        'monthly_summary',   -- Monthly memory consolidation
        'yearly_summary',    -- Yearly memory consolidation
        'wrapup_report'      -- 8AM & 5PM wrap-up reports
    )),
    content TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure only one active prompt per type
CREATE UNIQUE INDEX idx_system_prompts_active_type ON system_prompts(type, is_active) WHERE is_active = TRUE;

-- Memories table: consolidated learnings
CREATE TABLE IF NOT EXISTS memories (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('daily', 'weekly', 'monthly', 'yearly')),
    content TEXT NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_dates ON memories(start_date, end_date);

-- Wrap-up reports table: 8AM and 5PM summaries
CREATE TABLE IF NOT EXISTS wrapup_reports (
    id BIGSERIAL PRIMARY KEY,
    report_time TIMESTAMP WITH TIME ZONE NOT NULL,
    email_count INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wrapup_reports_time ON wrapup_reports(report_time);
