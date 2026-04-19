# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail Triage Assistant — an AI-powered email management system that
automatically categorises, labels, and processes Gmail messages through a
multi-stage AI pipeline.

## Architecture (current)

The deployed system runs entirely on **Cloudflare Workers**. See
`cloudflare/` — that's the active codebase. Deployed at
`gmail-assistant.loke.tools`.

- **Runtime**: Cloudflare Worker (TypeScript)
- **Routing**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Queues**: Cloudflare Queues (multi-stage pipeline — see below)
- **Scheduling**: Cloudflare Cron Triggers
- **Frontend**: React SPA (Vite + TypeScript + React Router v7 +
  shadcn/ui + Tailwind CSS) in `frontend/`, built to `frontend/dist` and
  served by the Worker via the `[assets]` binding
- **Auth**: OAuth with Google (client ID + secret, stored as Worker
  secrets). Optional domain/email allowlist via `ALLOWED_DOMAIN` and
  `ALLOWED_EMAILS` vars.
- **AI**: OpenAI Chat Completions with structured JSON output. Per-stage
  model selection via `OPENAI_MODEL_*` vars (see §Pipeline below).

### Retired stack

`cmd/` and `internal/` contain the original Go + PostgreSQL
implementation. It is no longer deployed; do not modify unless explicitly
asked. All new work lands under `cloudflare/`.

## Dev workflow

```bash
cd cloudflare
npm run dev          # wrangler dev — local Worker + D1
npm run migrate      # apply migrations to local D1

# Frontend (in another terminal)
cd frontend && npm run dev  # Vite, proxies /api + /auth to the Worker
```

Deploy: `cd cloudflare && npm run deploy` (builds the SPA, then
`wrangler deploy`).

## Pipeline

Emails go through a multi-stage queue pipeline (introduced in migration
`0003_pipeline.sql`). See `cloudflare/PIPELINE_PLAN.md` for the design
doc.

```
cron (*/15 * * * *) → pollGmail → TRIAGE_QUEUE
                                       │
                                       ▼ stage 1 (triage)
                      ┌──────┬──────┬──┴──┬──────┬──────┐
                      ▼      ▼      ▼     ▼      ▼      ▼
                NEWSLETTER NOTIF HUMAN TRANS SECURITY CALENDAR
                      │      │      │     │      │      │
                      └──────┴──────┴─────┴──────┴──────┘
                                       ▼
                           apply to Gmail + persist
```

### Stage 1 — Triage

Classifies each email into one of six buckets: `newsletter`,
`notification`, `human`, `transactional`, `security`, `calendar`. Three
paths in priority order:

1. **Thread-reply fast path** — `In-Reply-To` header matches an email
   we've already processed → inherit the thread's prior bucket, no AI
   call.
2. **Consistent-sender fast path** — sender profile has
   `bucket_consistency = 'consistent'` → route to the cached
   `primary_bucket`, no AI call.
3. **AI triage** — everything else (unknown sender, mixed sender, not
   yet consistent). Returns `{bucket, confidence, reasoning}`.

After each triage result, the sender profile's `bucket_counts` is
updated and consistency re-evaluated (≥ 5 samples + ≥ 90% in one
bucket → `consistent`; else `mixed`).

### Stage 2 — Bucket-specific processors

- **Newsletter** — score interestingness (0–10), flag interesting ones
  for the daily digest, archive with a timed delete label.
- **Notification** — severity/urgency assessment; high → inbox + push,
  low → archive + digest.
- **Human** — gated by the sender's auto-learned rating (0–100); below
  threshold → archive + digest, above → inbox (and optional draft
  reply).
- **Transactional** — extract vendor/amount/date, label
  `transactional/<vendor>`, archive with timed delete.
- **Security** — MFA/resets/login alerts; inbox + push fast lane, OTPs
  get a short-lived timed delete.
- **Calendar** — extract event details, `calendar/` label, notify if
  imminent.

### Sender rating (auto-learned)

Stored on `sender_profiles`. Auto-learned from user behaviour — archive
rate, reply rate, label edits, reads. Refreshed on bootstrap, every Nth
email, and a nightly sweep. Manual overrides win (`rating_manual = 1`).
Surfaced in the Settings → Senders UI.

### Daily digest

Composed at 8 AM, one HTML email per user sent via the user's own Gmail
OAuth token (appears in Sent folder). Three sections: interesting
newsletters, low-priority notifications, quiet humans. Persisted in
`daily_digests` for browsing in the UI.

### Memory consolidation

Unchanged from the original design. Daily (5 PM), weekly (6 PM Sat),
monthly (7 PM 1st), yearly (8 PM Jan 1). Each level is generated from
the level below. Memories are passed to AI during email processing as
historical context.

### Wrapup reports

Unchanged. Morning (8 AM) and evening (5 PM) summaries of the day's
activity. Additive to the daily digest.

## Configuration

- Per-user system prompts + per-label usage reasons via the web UI.
- Per-stage OpenAI model selection via `wrangler.toml` vars
  (`OPENAI_MODEL_TRIAGE`, `OPENAI_MODEL_HUMAN`, etc.), falling back to
  `OPENAI_MODEL` when unset.
- Per-user `pipeline_version` flag (`v1` = legacy single-stage
  processor, `v2` = new multi-stage pipeline). New users default to
  `v1` until manually flipped during rollout.

## Database schema

Migrations live in `cloudflare/migrations/`. Key tables:

- `users` — OAuth tokens, Pushover/webhook config, `pipeline_version`
- `emails` — processed emails; primary key is Gmail message ID; includes
  `bucket`, `pipeline_stage`, bucket-specific columns
- `sender_profiles` — per-sender / per-domain profiles with rating +
  bucket consistency
- `labels`, `system_prompts`, `ai_prompts`, `memories`,
  `wrapup_reports`, `notifications`, `daily_digests`

## Future enhancements

- Human thumbs up/down feedback loop for AI decisions
- Automatic learning from user-applied label corrections
