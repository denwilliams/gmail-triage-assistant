-- Add users table for multi-user OAuth support

-- Users table: stores authenticated users and their OAuth tokens
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,             -- User's Gmail address
    google_id TEXT NOT NULL UNIQUE,         -- Google user ID
    access_token TEXT NOT NULL,             -- OAuth access token (encrypted in production)
    refresh_token TEXT NOT NULL,            -- OAuth refresh token (encrypted in production)
    token_expiry TIMESTAMP WITH TIME ZONE NOT NULL, -- When access token expires
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- Whether monitoring is enabled for this user
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- Add user_id to emails table to track which user the email belongs to
ALTER TABLE emails ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);

-- Add user_id to labels table (each user has their own label configuration)
ALTER TABLE labels ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_name_key; -- Remove global unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_labels_user_name ON labels(user_id, name); -- Make name unique per user

-- Add user_id to system_prompts (each user can customize their prompts)
ALTER TABLE system_prompts ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE system_prompts DROP CONSTRAINT IF EXISTS system_prompts_type_key;
DROP INDEX IF EXISTS idx_system_prompts_active_type;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_user_type_active ON system_prompts(user_id, type, is_active) WHERE is_active = TRUE;

-- Add user_id to memories (each user has their own memories)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);

-- Note: wrapup_reports user_id is added in migration 004 when table is created
