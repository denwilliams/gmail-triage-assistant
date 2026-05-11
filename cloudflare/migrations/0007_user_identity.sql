-- Per-user identity hint. Free-form text describing who the user is —
-- their preferred name, aliases, common email addresses they appear under,
-- and anything else useful for the AI to recognise them in To/Cc lines
-- or in email bodies. Fed into the human-bucket prompt so the model can
-- tell the difference between an email addressed to the user and one
-- they were merely CC'd on, and so it doesn't draft replies on the
-- user's own outbound emails.

ALTER TABLE users ADD COLUMN user_identity TEXT NOT NULL DEFAULT '';
