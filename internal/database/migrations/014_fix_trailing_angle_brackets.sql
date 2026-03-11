-- Clean up trailing '>' from email addresses caused by RFC 5322 "Name <addr>" format
UPDATE emails SET from_address = RTRIM(from_address, '> ') WHERE from_address LIKE '%>';
UPDATE notifications SET from_address = RTRIM(from_address, '> ') WHERE from_address LIKE '%>';

-- For sender_profiles, a clean version may already exist, so merge duplicates first:
-- Add counts from the dirty row into the clean row, then delete the dirty row.
UPDATE sender_profiles AS clean
SET email_count = clean.email_count + dirty.email_count,
    emails_archived = clean.emails_archived + dirty.emails_archived,
    emails_notified = clean.emails_notified + dirty.emails_notified,
    last_seen_at = GREATEST(clean.last_seen_at, dirty.last_seen_at),
    modified_at = NOW()
FROM sender_profiles AS dirty
WHERE dirty.identifier LIKE '%>'
  AND clean.user_id = dirty.user_id
  AND clean.profile_type = dirty.profile_type
  AND clean.identifier = RTRIM(dirty.identifier, '> ')
  AND clean.id != dirty.id;

DELETE FROM sender_profiles
WHERE identifier LIKE '%>'
  AND EXISTS (
    SELECT 1 FROM sender_profiles AS clean
    WHERE clean.user_id = sender_profiles.user_id
      AND clean.profile_type = sender_profiles.profile_type
      AND clean.identifier = RTRIM(sender_profiles.identifier, '> ')
      AND clean.id != sender_profiles.id
  );

-- Now safe to rename the remaining dirty ones (no conflict)
UPDATE sender_profiles SET identifier = RTRIM(identifier, '> ') WHERE identifier LIKE '%>';
