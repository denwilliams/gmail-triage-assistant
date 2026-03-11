-- Strip display names from from_address: "Name <user@example.com>" → "user@example.com"
UPDATE emails
SET from_address = SUBSTRING(from_address FROM '<([^>]+)>')
WHERE from_address LIKE '%<%>%';

UPDATE notifications
SET from_address = SUBSTRING(from_address FROM '<([^>]+)>')
WHERE from_address LIKE '%<%>%';

-- Add domain column to emails for efficient grouping/filtering
ALTER TABLE emails ADD COLUMN IF NOT EXISTS from_domain TEXT NOT NULL DEFAULT '';
UPDATE emails SET from_domain = LOWER(split_part(from_address, '@', 2)) WHERE from_domain = '';
CREATE INDEX IF NOT EXISTS idx_emails_from_domain ON emails (from_domain);
