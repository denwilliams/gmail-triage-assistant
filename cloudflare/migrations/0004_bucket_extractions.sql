-- Bucket-specific structured extraction columns.
-- Stage-2 processors already produce these fields via the AI response
-- schemas in services/ai.ts — this migration lets us persist them as
-- typed columns so the per-bucket UIs can aggregate and query without
-- regexing the reasoning text.

-- ============================================================================
-- Transactional — vendor, document type, amount
-- ============================================================================
ALTER TABLE emails ADD COLUMN vendor TEXT;
ALTER TABLE emails ADD COLUMN document_type TEXT;     -- receipt|invoice|shipping|order|booking|refund|other
ALTER TABLE emails ADD COLUMN amount TEXT;            -- currency + value, or null

CREATE INDEX IF NOT EXISTS idx_emails_vendor
  ON emails(user_id, vendor, processed_at)
  WHERE vendor IS NOT NULL;

-- ============================================================================
-- Security — action type + OTP flag
-- ============================================================================
ALTER TABLE emails ADD COLUMN action_type TEXT;       -- mfa|reset|login_alert|account_recovery|other
ALTER TABLE emails ADD COLUMN is_otp INTEGER;         -- 0/1, null for non-security rows

-- ============================================================================
-- Calendar — event metadata
-- ============================================================================
ALTER TABLE emails ADD COLUMN event_title TEXT;
ALTER TABLE emails ADD COLUMN event_starts_at TEXT;   -- ISO or null
ALTER TABLE emails ADD COLUMN event_ends_at TEXT;     -- ISO or null
ALTER TABLE emails ADD COLUMN event_location TEXT;
ALTER TABLE emails ADD COLUMN event_attendees TEXT NOT NULL DEFAULT '[]';  -- JSON array

CREATE INDEX IF NOT EXISTS idx_emails_event_starts_at
  ON emails(user_id, event_starts_at)
  WHERE event_starts_at IS NOT NULL;
