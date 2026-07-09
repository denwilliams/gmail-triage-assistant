-- Per-email state for the PWA mail client (served at /m/).
--
-- is_read     — read state as known to the app. New pipeline emails default to
--               unread; everything processed before this migration is marked
--               read so the feed doesn't light up with months of history.
-- archived_at — set when the user archives (or trashes) from the app. The home
--               feed hides archived emails; bucket history still shows them.
-- collapsed   — the user minimized this email to a slim line in the home feed.
ALTER TABLE emails ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN archived_at TEXT;
ALTER TABLE emails ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;

UPDATE emails SET is_read = 1;
