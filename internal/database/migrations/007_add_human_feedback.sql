-- Add human feedback field to emails for learning improvements
ALTER TABLE emails ADD COLUMN IF NOT EXISTS human_feedback TEXT DEFAULT '';

-- Create index for querying emails with feedback
CREATE INDEX IF NOT EXISTS idx_emails_human_feedback ON emails(user_id) WHERE human_feedback != '';
