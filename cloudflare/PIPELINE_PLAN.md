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

Stage 1 classifies every email into exactly one bucket. Buckets:

| Bucket | Examples | Default action |
|---|---|---|
| `newsletter` | Substack, marketing newsletters, product updates | Archive immediately, include in daily digest if interesting |
| `notification` | System alerts, monitoring, PR comments, social mentions | Severity/urgency assessment; high → inbox + push, low → archive + digest |
| `human` | Personal/professional correspondence | Gated by sender rating — high = inbox (+ optional draft), low = archive + digest |
| `transactional` | Receipts, invoices, order/shipping confirmations, booking confirmations | Archive with timed delete label (`🗑️/1m` etc.) |
| `security` | MFA codes, password resets, login alerts, account recovery | Immediate inbox + push (fast lane) |
| `calendar` | Invites, updates, cancellations | Inbox + extract event details |
| `thread_reply` | Reply to an existing thread you're part of | Inherit prior classification or re-run as `human` |
| `unknown` | Triage couldn't decide | Safe default — land in inbox, flag for review |

`thread_reply` is a meta-bucket — detected via `In-Reply-To` header against
emails we've already seen. Implementation-wise it routes to `human` but keeps
the prior thread context.

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

New module `services/ai.ts` — provider-agnostic interface:

```ts
interface AIClient {
  generateStructured<T>(modelId: string, systemPrompt: string,
                       userPrompt: string, schema: JSONSchema): Promise<T>;
  generateText(modelId: string, systemPrompt: string,
               userPrompt: string): Promise<string>;
}
```

- Default implementation uses Cloudflare Workers AI binding `env.AI`
  (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `@cf/meta/llama-3.1-8b-instruct`,
  `@cf/mistralai/mistral-small-3.1-24b-instruct`, etc.).
- Structured output via Workers AI `response_format: json_schema` where
  supported; fallback to JSON parsing + re-ask on failure.
- Per-stage model selection in `wrangler.toml` vars so swapping is a deploy,
  not a code change:
  - `AI_TRIAGE_MODEL`
  - `AI_NEWSLETTER_MODEL`
  - `AI_NOTIFICATION_MODEL`
  - `AI_HUMAN_MODEL`
  - `AI_TRANSACTIONAL_MODEL`
  - `AI_SECURITY_MODEL`
  - `AI_CALENDAR_MODEL`
  - `AI_SUMMARY_MODEL` (digests, wrapups, memories)
  - `AI_SENDER_RATING_MODEL`
- Keep the existing OpenAI client around unused for now; delete once the new
  pipeline is confirmed working in prod.

## 6. Pipeline stages

### 6.1 Stage 1 — Triage

Input: `{userId, messageId}` from poller.

Steps:
1. Dedup check (email already processed? short-circuit).
2. Fetch Gmail message (subject, from, headers, ~500 char body sample — triage
   doesn't need full body).
3. Check `In-Reply-To` header against `emails` table. If hit and the prior
   email was `human`, skip triage and route straight to `HUMAN_Q` as a
   `thread_reply`.
4. Look up sender + domain profiles. If profile's `sender_type` strongly
   signals a bucket (e.g. `newsletter` with high confidence), fast-path
   without calling AI.
5. Otherwise, AI call: `{bucket, confidence, reasoning}`.
6. Write `emails` row with `bucket`, `triage_reasoning`, `pipeline_stage =
   'bucketed'`. Full analysis fields populated in stage 2.
7. Send `{userId, messageId, bucket}` to the bucket's queue.

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

Delivered by email (user's choice over in-app, per their instruction).

- New background job `daily_digest` triggered at 8 AM cron alongside morning
  wrapup.
- Composes one HTML email per user with sections:
  - **Newsletters worth your time** — items flagged as interesting over the
    last 24h, with AI-generated "why it's interesting" blurbs.
  - **Notifications summary** — low/medium items grouped by sender, each with
    a 1-line justification and deep link.
  - **Quiet humans** — low-rated human senders with 1-line summary and rating
    reason, so the user can spot bad gradings.
- Sent via Gmail API using the user's own OAuth token (`users.messages.send`
  with `X-GM-THRID` omitted; from = the user's own address). No external
  mail infrastructure needed.
- Persisted in a new `daily_digests` table for UI browsing + re-sending.

Keep the existing morning/evening wrapup reports as they are — the digest is
additive, not a replacement.

## 8. Sender rating (auto-learned)

Extend `sender_profiles`:

```sql
ALTER TABLE sender_profiles ADD COLUMN rating INTEGER;            -- 0..100
ALTER TABLE sender_profiles ADD COLUMN rating_reasoning TEXT;
ALTER TABLE sender_profiles ADD COLUMN rating_manual INTEGER NOT NULL DEFAULT 0; -- 1 if user overrode
ALTER TABLE sender_profiles ADD COLUMN rating_updated_at TEXT;
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

## 11. `wrangler.toml` changes

- Replace `*/5 * * * *` with `*/15 * * * *` (15-minute poll per user instruction).
- Add `[ai]` binding and per-stage model vars.
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

## 14. Open questions

1. **Digest threshold tuning** — start with newsletter `interesting_score >=
   6`, human `rating >= 40`; let the user tune via settings UI, or
   auto-adjust based on what they actually read?
2. **Security bucket verification** — phishing attempts often impersonate
   MFA/reset emails. Worth adding a DKIM/SPF sanity check before trusting the
   "security" bucket?
3. **Workers AI model availability** — do we want a hard requirement on
   Workers AI, or allow a per-stage fallback to OpenAI via the same interface
   when a WAI model is saturated?
4. **Historical backfill** — re-run stage 1 over existing emails to populate
   `bucket`, or leave legacy emails as `bucket = null` and only classify from
   cutover onward?
5. **Gmail send for digests** — using the user's own account is cleanest but
   means the digest shows up in "Sent". Alternative: drop into a dedicated
   `[assistant]/digests` label as a draft-ish message, or use a separate
   `noreply@` address via a transactional provider. Recommendation: user's
   own account with a self-label for now; revisit if it gets noisy.

---

Reply with "go" to proceed, or redirect on any of the above.
