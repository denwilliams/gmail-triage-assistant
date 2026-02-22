# Architecture

Gmail Triage Assistant is a Go backend that automatically categorises and labels incoming Gmail messages using a two-stage AI pipeline. It runs on a Raspberry Pi, stores data in PostgreSQL, and is exposed publicly via a Cloudflare Tunnel.

---

## Deployment Overview

```
                        ┌─────────────────────────────────────┐
                        │          Raspberry Pi               │
                        │                                     │
  Browser (LAN) ───────▶│ :8080  Go backend ◀─── PostgreSQL  │
                        │            │                        │
  Browser (remote)      │        cloudflared                  │
       │                └────────────│────────────────────────┘
       │                             │ outbound tunnel
       └───────────────────────────▶ Cloudflare Edge
```

- **LAN access**: `http://raspberrypi.local:8080` (requires `SERVER_HOST=0.0.0.0`)
- **Remote access**: via Cloudflare Tunnel public URL (no port forwarding needed)

---

## Email Processing Pipeline

Every email passes through a two-stage AI pipeline:

```
Email (subject + body + sender)
  │
  ├─ Stage 1: Content Analysis (OpenAI)
  │    Inputs:  subject, body (truncated to 5000 chars), sender, past slugs from same sender
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

## Email Monitoring

A polling goroutine checks Gmail every N minutes (default 5) for all active users.

---

## Self-Improvement System

The system builds a hierarchy of AI-generated memories from past email processing decisions. These memories are injected into Stage 2 as context, improving labelling accuracy over time.

### Scheduled jobs

| Time | Job |
|---|---|
| 8AM daily | Morning wrap-up report (emails since 5PM yesterday) |
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

---

## Component Map

```
cmd/server/main.go          — wires everything together, starts goroutines
internal/config/            — env var loading and validation
internal/database/          — PostgreSQL queries and migrations
internal/gmail/             — Gmail API client (fetch, label, archive)
  multi_monitor.go          — polling goroutine for all active users
internal/pipeline/          — two-stage AI processing pipeline
internal/web/               — HTTP server, OAuth flow, UI handlers
internal/scheduler/         — time-based job runner (wrap-ups, memories)
internal/memory/            — AI memory generation and consolidation
internal/wrapup/            — morning/evening wrap-up report generation
internal/openai/            — OpenAI API client
```

---

## Data Model (key tables)

| Table | Purpose |
|---|---|
| `users` | OAuth tokens, active flag |
| `emails` | Per-email analysis results: slug, keywords, summary, labels applied, bypass flag, reasoning |
| `memories` | Daily/weekly/monthly/yearly AI-generated memory content |
| `system_prompts` | User-configurable prompts for Stage 1 and Stage 2 |
| `labels` | User's Gmail labels with descriptions and example reasons |

---

## Security Notes

- **Session cookies**: use `SESSION_SECRET` from env; `Secure` flag set automatically when a non-default secret is configured
- **OAuth tokens**: stored in the database, refreshed automatically before Gmail API calls
