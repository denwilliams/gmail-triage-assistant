-- Track whether human feedback has been included in a memory
ALTER TABLE emails ADD COLUMN IF NOT EXISTS feedback_dirty BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_emails_feedback_dirty ON emails(user_id) WHERE feedback_dirty = TRUE;
