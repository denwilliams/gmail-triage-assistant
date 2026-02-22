# Architecture

Gmail Triage Assistant is a Go backend that automatically categorises and labels incoming Gmail messages using a two-stage AI pipeline. It runs on a Raspberry Pi, stores data in PostgreSQL, and can be exposed publicly via a Cloudflare Tunnel.

---

## Deployment Overview

```
                        ┌─────────────────────────────────────┐
                        │          Raspberry Pi               │
                        │                                     │
  Browser (LAN) ───────▶│ :8080  Go backend ◀─── PostgreSQL  │
                        │            │                        │
  Browser (remote)      │            │                        │
       │                │        cloudflared                  │
       │                └────────────│────────────────────────┘
       │                             │ outbound tunnel
       │                    ┌────────▼────────┐
       └───────────────────▶│ Cloudflare Edge │
                            └────────┬────────┘
                                     │ push POST
                            ┌────────▼────────┐
                            │ Google Pub/Sub  │
                            └────────┬────────┘
                                     │ watch notification
                            ┌────────▼────────┐
                            │     Gmail       │
                            └─────────────────┘
```

- **LAN access**: `http://raspberrypi.local:8080` (direct, no tunnel involved)
- **Remote access**: via Cloudflare Tunnel public URL
- **Gmail push notifications**: Google Pub/Sub POSTs to the Cloudflare Tunnel URL — the tunnel is the public endpoint Google needs to reach

---

## Email Monitoring Modes

Two modes are supported. Set `PUSH_NOTIFICATIONS_ENABLED=true` to switch to push mode; polling is the default.

### Polling mode (default)

```
MultiUserMonitor goroutine
  └─ every N minutes: fetch unread messages for each user via Gmail API
       └─ pipeline.Processor.ProcessEmail()
```

No public URL required. Simple, works anywhere.

### Push notification mode

```
Gmail ──watch()──▶ Google Cloud Pub/Sub ──POST──▶ Cloudflare Tunnel
                                                        │
                                              /api/gmail/push (webhook)
                                                        │
                                              History API: fetch new messages
                                                        │
                                              pipeline.Processor.ProcessEmail()
```

Requires:
- A Cloudflare Tunnel providing a stable public HTTPS URL
- A Google Cloud Pub/Sub topic with a push subscription pointing to `https://<tunnel-url>/api/gmail/push?token=<PUBSUB_VERIFICATION_TOKEN>`
- `PUSH_NOTIFICATIONS_ENABLED=true`, `PUBSUB_TOPIC`, `PUBSUB_VERIFICATION_TOKEN` set in `.env`

Gmail watch registrations expire every 7 days. The scheduler renews them at 9AM daily for all active users.

---

## Email Processing Pipeline

Every email — whether arriving via polling or push — passes through the same two-stage AI pipeline.

```
Email (subject + body + sender)
  │
  ├─ Stage 1: Content Analysis (OpenAI)
  │    Inputs:  subject, body (truncated to 2000 chars), sender, past slugs from same sender
  │    Outputs: snake_case_slug, keywords[], summary
  │
  ├─ Stage 2: Action Determination (OpenAI)
  │    Inputs:  slug, keywords, summary, available Gmail labels (with descriptions), memory context
  │    Outputs: labels[], bypass_inbox bool, reasoning
  │
  ├─ Save to database (emails table)
  │
  └─ Apply to Gmail
       ├─ Add labels (create label if it doesn't exist)
       └─ Archive if bypass_inbox = true
```

Past slugs from the same sender are fed into Stage 1 to encourage consistent categorisation over time.

---

## Self-Improvement System

The system builds a hierarchy of AI-generated memories from past email processing decisions. These memories are injected into Stage 2 of the pipeline as context, improving labelling accuracy over time.

### Scheduled jobs

| Time | Job |
|---|---|
| 8AM daily | Morning wrap-up report (emails since 5PM yesterday) |
| 9AM daily | Gmail watch renewal (push mode only) |
| 5PM daily | Evening wrap-up report + daily memory generation |
| 6PM Saturday | Weekly memory (consolidates last 7 daily memories) |
| 7PM 1st of month | Monthly memory (consolidates weekly memories) |
| 8PM 1st January | Yearly memory (consolidates monthly memories) |

### Memory hierarchy

```
Daily memories (up to 7 kept)
  └─▶ Weekly memory
        └─▶ Monthly memory
              └─▶ Yearly memory
```

During email processing, the pipeline loads one memory from each level (yearly, monthly, weekly, up to 7 daily) and passes them to Stage 2 as `Past learnings from email processing`.

---

## Component Map

```
cmd/server/main.go          — wires everything together, starts goroutines
internal/config/            — env var loading and validation
internal/database/          — PostgreSQL queries and migrations
internal/gmail/             — Gmail API client (fetch, label, archive, watch, history)
  multi_monitor.go          — polling goroutine for all active users
internal/pipeline/          — two-stage AI processing pipeline
internal/web/               — HTTP server, OAuth flow, UI handlers
  gmail_push.go             — /api/gmail/push webhook handler
internal/scheduler/         — time-based job runner (wrap-ups, memories, watch renewal)
internal/memory/            — AI memory generation and consolidation
internal/wrapup/            — morning/evening wrap-up report generation
internal/openai/            — OpenAI API client
```

---

## Data Model (key tables)

| Table | Purpose |
|---|---|
| `users` | OAuth tokens, active flag, `gmail_history_id` checkpoint for History API |
| `emails` | Per-email analysis results: slug, keywords, summary, labels applied, bypass flag, reasoning |
| `memories` | Daily/weekly/monthly/yearly AI-generated memory content |
| `system_prompts` | User-configurable prompts for Stage 1 and Stage 2 |
| `labels` | User's Gmail labels with descriptions and example reasons |

---

## Security Notes

- **Session cookies**: use `SESSION_SECRET` from env; `Secure` flag is set automatically when a non-default secret is configured (i.e. in production)
- **Pub/Sub token**: verified with `crypto/subtle.ConstantTimeCompare` to prevent timing attacks
- **OAuth tokens**: stored in the database, refreshed automatically before Gmail API calls; refreshed tokens are persisted back to the database
