CREATE TABLE IF NOT EXISTS sender_profiles (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_type TEXT NOT NULL CHECK (profile_type IN ('sender', 'domain')),
    identifier TEXT NOT NULL,

    -- Raw counters
    email_count INT NOT NULL DEFAULT 0,
    emails_archived INT NOT NULL DEFAULT 0,
    emails_notified INT NOT NULL DEFAULT 0,
    slug_counts JSONB NOT NULL DEFAULT '{}',
    label_counts JSONB NOT NULL DEFAULT '{}',
    keyword_counts JSONB NOT NULL DEFAULT '{}',

    -- AI-classified
    sender_type TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',

    -- Timestamps
    first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    modified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sender_profiles_lookup ON sender_profiles(user_id, profile_type, identifier);
CREATE INDEX IF NOT EXISTS idx_sender_profiles_stale ON sender_profiles(modified_at);
