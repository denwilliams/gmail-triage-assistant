# Sender Profiles - Requirements Specification

## Overview

Add sender and domain profiling to the email processing pipeline. When an email arrives, look up profiles for both the sender's email address and their domain. These profiles provide rich context to both AI stages, improving decision quality through sender-specific intelligence.

## Profile Types

### Sender Profile
- Keyed by **email address** (e.g., `john@example.com`)
- Created for every sender, including free email providers
- One profile per user per sender address

### Domain Profile
- Keyed by **domain** (e.g., `example.com`)
- NOT created for free email providers (hardcoded ignore list)
- One profile per user per domain
- Independent from sender profiles (no parent-child hierarchy)

## Profile Content

Each profile (sender and domain) contains:

### Structured Fields
| Field | Type | Description |
|-------|------|-------------|
| email_count | int | Total emails processed from this sender/domain |
| first_seen | timestamp | When the first email was processed |
| last_seen | timestamp | When the most recent email was processed |
| top_slugs | jsonb | Most common slugs (up to 5), with counts |
| top_labels | jsonb | Most common labels applied, with counts |
| bypass_inbox_rate | float | Percentage of emails that were archived |
| notification_rate | float | Percentage of emails that triggered notifications |
| common_keywords | jsonb | Most frequently occurring keywords |
| sender_type | text | AI-classified: human, newsletter, automated, marketing, notification |

### AI Narrative Summary
- Free-text description of who this sender/domain is
- What they typically send
- How their emails should be handled
- Evolved incrementally (AI sees previous summary + new data, produces updated summary)

### Metadata
| Field | Type | Description |
|-------|------|-------------|
| modified_at | timestamp | Last time profile was updated (for staleness tracking) |
| created_at | timestamp | When the profile was first created |

## Ignored Domains (No Domain Profile)

Hardcoded list of free/consumer email providers. Domain profiles are NOT created for these. Sender profiles ARE still created for addresses at these domains.

```
gmail.com, googlemail.com, hotmail.com, outlook.com, live.com,
yahoo.com, yahoo.co.uk, aol.com, icloud.com, me.com, mac.com,
protonmail.com, proton.me, zoho.com, mail.com, gmx.com, gmx.net,
yandex.com, tutanota.com, fastmail.com
```

## Profile Lifecycle

### 1. Bootstrap (New Sender/Domain)

When an email arrives from an unknown sender:

1. Check database for sender profile by email address
2. Check database for domain profile (if not an ignored domain)
3. If no sender profile exists:
   - Query historical emails from that address (last 25 emails)
   - Make a **dedicated AI call** to generate the initial profile (structured fields + narrative summary)
   - Save the new profile
4. If no domain profile exists (and domain not ignored):
   - Query historical emails from that domain (last 25 emails)
   - Make a **dedicated AI call** to generate the initial domain profile
   - Save the new domain profile
5. Continue with normal email processing using the new profile(s)

### 2. Normal Processing (Known Sender)

1. Email arrives
2. Load sender profile + domain profile (if applicable)
3. Pass both profiles as context to **Stage 1** (content analysis) AND **Stage 2** (action generation)
4. Process email through the normal pipeline
5. After processing:
   - Update structured fields on sender profile (increment count, update rates, add slug/labels/keywords)
   - Update structured fields on domain profile (same)
   - Make an AI call to **evolve** the narrative summary (pass previous summary + new email outcome)
   - Update `modified_at` timestamp on both profiles

### 3. Stale Profile Cleanup

- Profiles with `modified_at` older than **1 year** are deleted
- Cleanup runs as a periodic job (can piggyback on existing scheduled tasks)

## Pipeline Integration

### Stage 1 (Content Analysis)
- Currently receives: past slugs from sender
- New: receives sender profile + domain profile (replaces/supplements past slugs)
- The profile's `top_slugs`, `sender_type`, and narrative summary inform slug generation

### Stage 2 (Action Generation)
- Currently receives: labels, memories, AI prompts
- New: also receives sender profile + domain profile
- The profile's behavioral metrics (bypass rate, notification rate, typical labels) and narrative inform action decisions

## Open Questions for Implementation

1. Should profile bootstrap be synchronous (block email processing) or async (process email normally, profile ready for next email)?
   - **Decision: Synchronous** - the profile should be available for the current email's processing
2. Should the profile summary evolution happen synchronously after email processing, or can it be deferred?
   - Worth considering: deferring summary evolution to avoid blocking the pipeline, while structured field updates happen immediately
3. Token budget for profiles in prompts - may need to set a max length for narrative summaries to avoid bloating prompt context

## User Stories

1. **As the system**, when I receive an email from a new sender, I bootstrap a profile from their historical emails so I have context from the first interaction.
2. **As the system**, when I process an email, I use the sender's profile and domain profile to make better categorization and action decisions.
3. **As the system**, after processing an email, I update the sender's profile so it stays current.
4. **As the system**, I automatically clean up profiles that haven't been seen in over a year.
5. **As a user**, I benefit from increasingly accurate email handling as the system learns about my senders.

## Acceptance Criteria

- [ ] New `sender_profiles` table with all structured fields + narrative summary
- [ ] Sender profiles keyed by (user_id, email_address), domain profiles keyed by (user_id, domain)
- [ ] Profile bootstrap from last 25 historical emails via dedicated AI call
- [ ] Hardcoded ignore list prevents domain profile creation for free email providers
- [ ] Both profiles passed to Stage 1 and Stage 2 as context
- [ ] Structured fields updated after each email processing
- [ ] AI narrative summary evolved after each email processing
- [ ] `modified_at` tracked and profiles older than 1 year cleaned up
- [ ] Existing `GetPastSlugsFromSender` functionality preserved or superseded by profile data
