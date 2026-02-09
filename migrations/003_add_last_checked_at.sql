-- Add last_checked_at timestamp to users table for incremental Gmail polling
-- DEFAULT to CURRENT_TIMESTAMP so new users only see emails from signup time forward
-- This prevents fetching historical emails and excessive API/OpenAI costs

ALTER TABLE users ADD COLUMN last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Set initial value to now for existing users
UPDATE users SET last_checked_at = CURRENT_TIMESTAMP WHERE last_checked_at IS NULL;
