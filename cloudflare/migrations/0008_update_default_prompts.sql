-- Update per-bucket prompts for users who still have the old default values.
-- Only overwrites rows that match the old defaults, preserving any customisations.

UPDATE system_prompts
SET content = 'You process newsletter emails. I''m interested in software engineering, AI, and finance. Mark anything purely promotional or lifestyle-focused as not worth reading. Flag deep technical content or investment analysis as interesting.',
    updated_at = datetime('now')
WHERE type = 'bucket_newsletter'
  AND content = 'You process newsletter emails. Score each for how likely it is to be worth the user''s time.';

UPDATE system_prompts
SET content = 'You process automated notification emails. Treat deployment failures, payment failures, and production alerts as high severity. Treat social media activity and marketing analytics as low urgency.',
    updated_at = datetime('now')
WHERE type = 'bucket_notification'
  AND content = 'You assess automated notifications for severity and urgency.';

UPDATE system_prompts
SET content = 'You process personal emails to me. I care most about emails from close colleagues, family, and friends. Emails from recruiters or people I''ve never replied to are lower priority. Be conservative with draft replies — only suggest one if a response seems clearly expected.',
    updated_at = datetime('now')
WHERE type = 'bucket_human'
  AND content = 'You process human emails to the user.';

UPDATE system_prompts
SET content = 'You process transactional emails. Accurately extract vendor, amount, and currency. Flag anything over $500 AUD as worth noting.',
    updated_at = datetime('now')
WHERE type = 'bucket_transactional'
  AND content = 'You process transactional emails — receipts, invoices, order/shipping confirmations, bookings.';

UPDATE system_prompts
SET content = 'You process security emails. Treat any unrecognised login or suspicious activity as high priority regardless of the sender''s tone.',
    updated_at = datetime('now')
WHERE type = 'bucket_security'
  AND content = 'You process security-related emails — MFA codes, password resets, login alerts, account recovery.';

UPDATE system_prompts
SET content = 'You process calendar emails. Prioritise events I''m an organiser or required attendee on. Flag recurring meetings as lower urgency than one-off events.',
    updated_at = datetime('now')
WHERE type = 'bucket_calendar'
  AND content = 'You process calendar emails — meeting invites, updates, cancellations.';
