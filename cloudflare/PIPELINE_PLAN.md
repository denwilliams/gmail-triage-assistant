# Multi-Stage Email Queue Pipeline — Plan

Status: **proposal** — nothing implemented yet. Review and redirect before code lands.

## 1. Goal

Replace the current single-stage `processEmail` pipeline with a multi-stage
queue pipeline where emails are classified into buckets first, then routed to
bucket-specific processors. Each stage calls a different, individually
configurable Cloudflare Workers AI model so cheap models handle triage and
more capable models only see the work that warrants them.

## 2. Relationship to existing code

The existing `cloudflare/` stack already covers:

- D1 schema, OAuth, Gmail client, cron triggers, two queues, wrapup/memory
  jobs, sender profiles, frontend assets served via `[assets]`.

This is a **refactor of `pipeline/processor.ts` + `services/openai.ts`** and the
queue topology — not a fresh stack. The Go implementation under `cmd/` and
`internal/` is untouched.

## 3. Buckets

Six concrete buckets — every email ends up in exactly one:

| Bucket | Examples | Default action |
|---|---|---|
| `newsletter` | Substack, marketing newsletters, product updates | Archive immediately, include in daily digest if interesting |
| `notification` | System alerts, monitoring, PR comments, social mentions | Severity/urgency assessment; high → inbox + push, low → archive + digest |
| `human` | Personal/professional correspondence | Gated by sender rating — high = inbox (+ optional draft), low = archive + digest |
| `transactional` | Receipts, invoices, order/shipping confirmations, booking confirmations | Archive with timed delete label (`🗑️/1m` etc.) |
| `security` | MFA codes, password resets, login alerts, account recovery | Immediate inbox + push (fast lane) |
| `calendar` | Invites, updates, cancellations | Inbox + extract event details |

Triage is not always an AI call — see §6.1 for the three-path routing
(thread-reply fast path, consistent-sender fast path, AI triage). Senders
who send multiple bucket types (e.g. Amazon sends order confirmations,
marketing, shipping updates, Prime Video notifications) are flagged
`mixed` on the profile and always go through AI triage; single-purpose
senders (a Substack, a friend) fast-path after we've seen N emails from
them.

## 4. Queue topology

```
Gmail poll (every 15m cron)
         │
         ▼
┌──────────────────┐
│  TRIAGE_QUEUE    │  Stage 1 — classify into bucket (cheap model)
└──────────────────┘
         │
    ┌────┴──────────────────┬────────────┬────────────┬─────────────┐
    ▼                       ▼            ▼            ▼             ▼
NEWSLETTER_Q   NOTIFICATION_Q   HUMAN_Q   TRANSACTIONAL_Q   SECURITY_Q   CALENDAR_Q
    │                       │            │            │             │
    └────────┬───────────────┴────────────┴────────────┴─────────────┘
             ▼
     (apply to Gmail + persist email row)
```

Each bucket queue is a Cloudflare Queue with its own consumer binding. Retries
and batch sizes per queue; failed messages go to DLQ via `max_retries`.

Background jobs queue stays as-is. Add a new job type `daily_digest` that
composes and sends the per-bucket digest emails (see §7).

## 5. AI abstraction

Stay on OpenAI for this PR (minimise change surface). The existing
`services/openai.ts` chat completion + structured output plumbing is reused;
we just add per-stage model selection so we can run cheap models where they're
good enough.

- Refactor `services/openai.ts` → `services/ai.ts`:
  - Keep existing `chatCompletion` / structured-output helpers.
  - Stage-specific wrappers (`triage()`, `processNewsletter()`,
    `processNotification()`, `processHuman()`, `processTransactional()`,
    `processSecurity()`, `processCalendar()`, `rateSender()`,
    `composeDigest()`) each take a `model` arg.
- Per-stage model config via `wrangler.toml` vars so swapping is a deploy,
  not a code change — and easy to A/B:
  - `OPENAI_MODEL_TRIAGE` (default: `gpt-5-nano` — cheap, fast)
  - `OPENAI_MODEL_NEWSLETTER`
  - `OPENAI_MODEL_NOTIFICATION`
  - `OPENAI_MODEL_HUMAN` (likely the most capable model — inbox decisions matter)
  - `OPENAI_MODEL_TRANSACTIONAL`
  - `OPENAI_MODEL_SECURITY`
  - `OPENAI_MODEL_CALENDAR`
  - `OPENAI_MODEL_SUMMARY` (digests, wrapups, memories)
  - `OPENAI_MODEL_SENDER_RATING`
  - Existing `OPENAI_MODEL` kept as a fallback when a stage-specific var is
    unset.
- Workers AI migration deferred — the `AIClient` interface stays provider-
  agnostic so swapping later is a one-module change.

## 6. Pipeline stages

### 6.1 Stage 1 — Triage

Input: `{userId, messageId}` from poller.

Steps:
1. Dedup check — email already processed? short-circuit.
2. Fetch Gmail message (subject, from, headers, short body sample — triage
   doesn't need full body).
3. **Thread-reply fast path** — check `In-Reply-To` header against the
   `emails` table. On hit: inherit the thread's prior bucket, skip AI.
   Most will be `human`, some `notification` (e.g. GitHub PR comment
   thread) — inheriting is correct either way.
4. **Consistent-sender fast path** — look up sender profile. If
   `bucket_consistency = 'consistent'` and `primary_bucket` is set → route
   straight to that bucket queue, skip AI.
5. **AI triage** — everything else (unknown sender, `mixed` sender, not
   yet consistent). AI call returns `{bucket, confidence, reasoning}`.
6. Write `emails` row with `bucket`, `triage_reasoning`,
   `pipeline_stage = 'bucketed'`. Full analysis fields populated in
   stage 2.
7. Update sender profile `bucket_counts[bucket]++`, re-evaluate
   consistency (see §8.1).
8. Enqueue `{userId, messageId, bucket}` onto the bucket's queue.

### 6.1.1 Consistency evaluation

After each triage result, recompute the sender profile's consistency:

- `bucket_counts` total < `CONSISTENCY_MIN_SAMPLES` (default 5) →
  `unknown`. Keep AI-triaging.
- Top bucket has ≥90% share (`CONSISTENCY_THRESHOLD`) → `consistent`,
  cache `primary_bucket`.
- Otherwise → `mixed`, `primary_bucket = null`.

If a sender was `consistent` but the new triage result disagrees with
`primary_bucket`, drop back to `unknown` and require another
`CONSISTENCY_MIN_SAMPLES` before re-deciding. Catches senders who
branch out (e.g. a newsletter starting to send receipts).

### 6.2 Stage 2 — Newsletter

- AI call on subject + body: produce `interesting_score (0-10)`,
  `interesting_reasons[]`, short `summary`, `keywords[]`.
- Always archive (`bypass_inbox = true`). Apply `🗑️/1m` timed label.
- If `interesting_score >= threshold` (configurable, default 6), flag for
  daily digest.
- Persist to `emails` row.

### 6.3 Stage 2 — Notification

- AI call: `severity (low|medium|high|critical)`, `urgency (low|medium|high)`,
  `summary`, `action_required (bool)`, `reasoning`.
- `severity >= high` OR `urgency >= high` → keep in inbox, send push/webhook
  notification, optionally `draft_reply` if `action_required`.
- Otherwise → archive, include in daily notification summary with a deep link
  back to the Gmail thread.

### 6.4 Stage 2 — Human

- Look up sender rating (see §8). If rating is below threshold (default 40),
  treat as low-priority human → archive + include in daily "ignored humans"
  digest with justification (so the user can spot misgrading).
- If rating is above threshold: apply labels, keep in inbox, optionally
  generate a draft reply.
- Salesperson classification (`sender_type == 'sales'` or similar) biases the
  rating lower but doesn't auto-archive on its own — the rating decides.

### 6.5 Stage 2 — Transactional

- Extract: vendor, amount, date, document type.
- Apply label `transactional/` (+ vendor sublabel e.g. `transactional/amazon`).
- Apply timed label `🗑️/1m` for receipts, `📥/1y` for invoices/tax-relevant.
- Always archive.

### 6.6 Stage 2 — Security

- Extract: action type (login/MFA/reset), originating IP/location if present,
  freshness.
- Keep in inbox, send push/webhook.
- Apply `🗑️/1d` if it's an OTP code (short-lived by nature).

### 6.7 Stage 2 — Calendar

- Extract: event title, start/end, attendees, location/link.
- Label `calendar/`, keep in inbox.
- Notify if the event is within the next N hours (configurable).

## 7. Daily digest emails

Delivered by email, sent via the user's own Gmail OAuth token (same
mechanism as the existing `createDraft` flow — just `users.messages.send`
instead of `.drafts.create`). `From:` = the user's own address; the
digest shows up in their Sent folder. No external mail provider, no bot
from-address.

- New background job `daily_digest` triggered at 8 AM cron alongside morning
  wrapup.
- Composes one HTML email per user with sections:
  - **Newsletters worth your time** — items flagged as interesting
    (`interesting_score >= 6`) over the last 24h, with AI-generated "why
    it's interesting" blurbs.
  - **Notifications summary** — low/medium items grouped by sender, each
    with a 1-line justification and deep link to the Gmail thread.
  - **Quiet humans** — low-rated human senders (`rating < 40`) with
    1-line summary and rating reason, so the user can spot bad gradings.
- Persisted in a new `daily_digests` table for UI browsing + re-sending.

Keep the existing morning/evening wrapup reports as they are — the digest
is additive, not a replacement.

## 8. Sender rating + bucket consistency (auto-learned)

Extend `sender_profiles`:

```sql
-- Rating (for human bucket gating)
ALTER TABLE sender_profiles ADD COLUMN rating INTEGER;            -- 0..99
ALTER TABLE sender_profiles ADD COLUMN rating_reasoning TEXT;
ALTER TABLE sender_profiles ADD COLUMN rating_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sender_profiles ADD COLUMN rating_updated_at TEXT;

-- Bucket consistency (for triage fast path)
ALTER TABLE sender_profiles ADD COLUMN bucket_consistency TEXT NOT NULL DEFAULT 'unknown';
  -- 'unknown' | 'consistent' | 'mixed'
ALTER TABLE sender_profiles ADD COLUMN primary_bucket TEXT;       -- null when not consistent
ALTER TABLE sender_profiles ADD COLUMN bucket_counts TEXT NOT NULL DEFAULT '{}';
  -- JSON: { newsletter: 12, transactional: 3, ... }
```

Signals to auto-learn from:

- User opens the email in Gmail (detected by `UNREAD` label removal on next
  poll cycle, vs bulk archive).
- User manually applies/removes labels (reconciled on next `messages.modify`
  by comparing Gmail state with stored `labels_applied`).
- User replies (detected via outgoing sent folder scan + thread ID match).
- Historical archive rate, notification rate, reply rate.

Rating is produced by a dedicated AI call (`AI_SENDER_RATING_MODEL`) that
takes the aggregated signals and outputs `{rating, reasoning}`. Runs:

- On profile bootstrap (first sight).
- After every Nth email from that sender (default 5).
- Nightly sweep for stale profiles (>30 days since last rating, still active).

If `rating_manual = 1` the auto-learned rating is not overwritten, but a
suggested rating is still produced and surfaced in the UI.

## 9. Domain / user lock

Google OAuth config:

- Pass `hd=<domain>` param when the owner sets `ALLOWED_DOMAIN` env var
  (Google Workspace only — rejects other domains at Google's side).
- Unconditionally reject any `userinfo.email` not matching
  `ALLOWED_EMAILS` (comma-separated allowlist env var) in our callback, for
  personal Gmail owners.
- Document both in README.

## 10. Schema changes (migration `0003_pipeline.sql`)

```sql
-- Bucket pipeline columns
ALTER TABLE emails ADD COLUMN bucket TEXT;                    -- nullable until triaged
ALTER TABLE emails ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'queued';
ALTER TABLE emails ADD COLUMN triage_reasoning TEXT;
ALTER TABLE emails ADD COLUMN severity TEXT;                  -- notifications
ALTER TABLE emails ADD COLUMN urgency TEXT;                   -- notifications
ALTER TABLE emails ADD COLUMN interesting_score INTEGER;      -- newsletters
ALTER TABLE emails ADD COLUMN interesting_reasons TEXT;       -- JSON array
ALTER TABLE emails ADD COLUMN in_reply_to TEXT;               -- header
ALTER TABLE emails ADD COLUMN thread_id TEXT;

CREATE INDEX idx_emails_bucket ON emails(user_id, bucket, processed_at);
CREATE INDEX idx_emails_pipeline_stage ON emails(user_id, pipeline_stage);

-- Sender rating
ALTER TABLE sender_profiles ADD COLUMN rating INTEGER;
ALTER TABLE sender_profiles ADD COLUMN rating_reasoning TEXT;
ALTER TABLE sender_profiles ADD COLUMN rating_manual INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sender_profiles ADD COLUMN rating_updated_at TEXT;

-- Bucket consistency (fast-path triage)
ALTER TABLE sender_profiles ADD COLUMN bucket_consistency TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE sender_profiles ADD COLUMN primary_bucket TEXT;
ALTER TABLE sender_profiles ADD COLUMN bucket_counts TEXT NOT NULL DEFAULT '{}';

-- Daily digest persistence
CREATE TABLE daily_digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    digest_date TEXT NOT NULL,
    content TEXT NOT NULL,          -- HTML
    sections TEXT NOT NULL,         -- JSON { newsletters:[], notifications:[], quietHumans:[] }
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, digest_date)
);
```

## 11. Polling + `wrangler.toml` changes

- Polling logic (`jobs/poll-gmail.ts`) is unchanged: fetch since
  `last_checked_at`, enqueue each message. The only difference is it now
  enqueues onto the **triage queue** instead of the monolithic processing
  queue.
- Bump cron from `*/5 * * * *` to `*/15 * * * *` (15-minute poll per earlier
  agreement).
- Add per-stage `OPENAI_MODEL_*` vars (see §5). No Workers AI binding.
- Add queue producers/consumers for `gmail-assistant-triage`,
  `gmail-assistant-bucket-newsletter`, `-notification`, `-human`,
  `-transactional`, `-security`, `-calendar`.
- Keep `gmail-assistant-processing` temporarily for rollback — remove once
  the new pipeline is confirmed.

## 12. File layout

```
cloudflare/src/
  pipeline/
    triage.ts                   # stage 1
    buckets/
      newsletter.ts
      notification.ts
      human.ts
      transactional.ts
      security.ts
      calendar.ts
    shared.ts                   # common helpers (profile load, labels, etc.)
  services/
    ai.ts                       # NEW — Workers AI client
    digest.ts                   # NEW — daily digest composer
    gmail.ts                    # extend: sendEmail()
  jobs/
    daily-digest.ts             # NEW
    sender-rating.ts            # NEW — nightly rating sweep
  db/
    digests.ts                  # NEW
    emails.ts                   # extend for new columns
    sender-profiles.ts          # extend for rating
  api/
    sender-ratings.ts           # NEW — list/override ratings
    digests.ts                  # NEW — browse past digests
  types/env.ts                  # new bindings/vars
```

Frontend: new page/section for sender ratings (list, filter by rating, edit
manually); digests tab showing past daily digests.

## 13. Rollout

1. Land migration + new code behind a per-user `pipeline_version` setting
   (defaults to `v1` = existing, switch individual users to `v2`).
2. Deploy. Switch your own account to `v2`. Compare outputs.
3. Flip default to `v2` once happy. Leave `v1` code for one release, then
   delete.

Also update `CLAUDE.md` — it currently describes the retired Go+Postgres
architecture and doesn't mention the deployed Cloudflare stack. Refresh it to
document the Workers / D1 / Queues reality and the new pipeline.

## 14. Decisions

1. **Digest thresholds** — fixed. Newsletter interesting `>= 6/10`, human
   rating `>= 40/99`. Not user-tunable in v1.
2. **Security bucket** — no DKIM/SPF sanity check. Trust Gmail's own spam
   handling.
3. **Historical backfill** — none. Legacy emails stay with `bucket = null`;
   only emails processed after cutover go through the new pipeline.
4. **Digest sender** — user's own Gmail token, `From:` = the user.
   Shows up in their Sent folder. Matches the existing `createDraft`
   mechanism.

---

Reply with "go" to proceed, or redirect on any of the above.
