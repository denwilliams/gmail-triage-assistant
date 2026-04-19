-- Per-user v2 pipeline settings. These expose knobs that the pipeline has
-- been reading as hardcoded constants up to now:
--   * digest newsletter threshold (was 6/10)
--   * human-bucket rating threshold (was 40/100)
--   * calendar imminent-notification window (was 60m)
--   * per-bucket push/webhook notification opt-outs (new — previously
--     any outcome.notificationMessage went to pushover + webhook)
--
-- All columns are NOT NULL with defaults matching the current behaviour,
-- so existing users see no change until they explicitly override.

ALTER TABLE users ADD COLUMN v2_newsletter_threshold INTEGER NOT NULL DEFAULT 6;
ALTER TABLE users ADD COLUMN v2_human_rating_threshold INTEGER NOT NULL DEFAULT 40;
ALTER TABLE users ADD COLUMN v2_calendar_imminent_minutes INTEGER NOT NULL DEFAULT 60;

-- JSON map of bucket → boolean. Missing keys are treated as `true` (allow)
-- by the pipeline, so the default '{}' preserves current behaviour where
-- every bucket that generates a notificationMessage is allowed to notify.
ALTER TABLE users ADD COLUMN v2_notify_buckets TEXT NOT NULL DEFAULT '{}';
