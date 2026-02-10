-- Ensure unique constraint exists on system_prompts(user_id, type)
-- This may have been added manually on some instances but needs to be in migrations
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_user_type ON system_prompts(user_id, type);
