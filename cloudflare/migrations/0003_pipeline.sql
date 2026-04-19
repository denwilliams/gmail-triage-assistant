-- Multi-stage pipeline schema additions
-- See cloudflare/PIPELINE_PLAN.md for context.

-- ============================================================================
-- Users — pipeline version flag for rollout (v1 = legacy, v2 = new pipeline)
-- ============================================================================
ALTER TABLE users ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT 'v1';

-- ============================================================================
-- Emails — bucket classification + stage-specific columns
-- ============================================================================
ALTER TABLE emails ADD COLUMN bucket TEXT;
ALTER TABLE emails ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE emails ADD COLUMN triage_reasoning TEXT;
ALTER TABLE emails ADD COLUMN triage_via TEXT;                -- 'ai' | 'thread_reply' | 'consistent_sender'
ALTER TABLE emails ADD COLUMN severity TEXT;                  -- notifications: low|medium|high|critical
ALTER TABLE emails ADD COLUMN urgency TEXT;                   -- notifications: low|medium|high
ALTER TABLE emails ADD COLUMN interesting_score INTEGER;      -- newsletters: 0-10
ALTER TABLE emails ADD COLUMN interesting_reasons TEXT NOT NULL DEFAULT '[]'; -- JSON array
ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
ALTER TABLE emails ADD COLUMN thread_id TEXT;
ALTER TABLE emails ADD COLUMN included_in_digest TEXT;        -- digest_date if included, else null

CREATE INDEX IF NOT EXISTS idx_emails_bucket ON emails(user_id, bucket, processed_at);
CREATE INDEX IF NOT EXISTS idx_emails_pipeline_stage ON emails(user_id, pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_emails_thread_id ON emails(user_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(user_id, in_reply_to);

-- ============================================================================
-- Sender profiles — rating (human gating) + bucket consistency (triage fast path)
-- ============================================================================
ALTER TABLE sender_profiles ADD COLUMN rating INTEGER;
ALTER TABLE sender_profiles ADD COLUMN rating_reasoning TEXT NOT NULL DEFAULT '';
ALTER TABLE sender_profiles ADD COLUMN rating_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sender_profiles ADD COLUMN rating_updated_at TEXT;

ALTER TABLE sender_profiles ADD COLUMN bucket_consistency TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE sender_profiles ADD COLUMN primary_bucket TEXT;
ALTER TABLE sender_profiles ADD COLUMN bucket_counts TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sender_profiles_rating ON sender_profiles(user_id, rating);

-- ============================================================================
-- Daily digests — one composed digest per user per day
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    digest_date TEXT NOT NULL,          -- YYYY-MM-DD
    content_html TEXT NOT NULL,
    content_text TEXT NOT NULL,
    sections TEXT NOT NULL DEFAULT '{}', -- JSON { newsletters: [...], notifications: [...], quietHumans: [...] }
    item_counts TEXT NOT NULL DEFAULT '{}', -- JSON { newsletters: 0, notifications: 0, quietHumans: 0 }
    sent_at TEXT,
    gmail_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, digest_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_digests_user_date ON daily_digests(user_id, digest_date DESC);
