# Cloudflare Workers Gmail Triage Assistant — Design Spec

## Goal

Build a fully Cloudflare-native version of the Gmail Triage Assistant using Workers, D1, Queues, and Cron Triggers. Lives in a `cloudflare/` subdirectory alongside the existing Go version. Same frontend, same API contract, different runtime.

## Motivation

- **Cost**: No always-on server or managed database — pay per request
- **Simplicity**: No server management, deploy with `wrangler deploy`
- **Portability**: Offer an alternative deployment target for users who prefer Cloudflare

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │ Worker (fetch)   │         │ Cron Triggers     │          │
│  ├──────────────────┤         ├──────────────────┤          │
│  │ • API routes     │         │ */5 * * * * poll  │          │
│  │ • OAuth flow     │         │ 0 8 * * * wrapup  │          │
│  │ • JWT auth       │         │ 0 17 * * * wrapup │          │
│  │ • SPA serving    │         │   + daily memory  │          │
│  └────────┬─────────┘         │ 0 18 * * 6 weekly │          │
│           │                   │ 0 19 1 * * monthly│          │
│           │                   │ 0 20 1 1 * yearly │          │
│           │                   └────────┬──────────┘          │
│           │                            │                     │
│  ┌────────▼────────────────────────────▼──────────┐         │
│  │          Queue (email-processing)               │         │
│  │  • email-processing: { userId, messageId }       │         │
│  │  • background-jobs: { userId, jobType }         │         │
│  │  • Built-in retries on failure                  │         │
│  └────────────────────┬───────────────────────────┘         │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────┐         │
│  │                    D1 Database                  │         │
│  │  • Users, emails, labels, prompts, memories     │         │
│  │  • Sender profiles, notifications, wrapups      │         │
│  │  • OAuth tokens (plaintext — same as Go version)  │         │
│  └─────────────────────────────────────────────────┘         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         │                    │                │
   ┌─────▼────┐    ┌────────▼──┐    ┌───────▼───────┐
   │ Gmail    │    │  OpenAI   │    │ Pushover /    │
   │   API    │    │    API    │    │ Webhooks      │
   └──────────┘    └───────────┘    └───────────────┘
```

## Directory Structure

```
cloudflare/
├── src/
│   ├── index.ts              # Worker entry: fetch, scheduled, queue handlers
│   ├── router.ts             # API route matching
│   ├── auth/
│   │   ├── oauth.ts          # Google OAuth login/callback
│   │   └── jwt.ts            # JWT sign/verify, middleware
│   ├── api/
│   │   ├── labels.ts         # CRUD label handlers
│   │   ├── emails.ts         # Email list + feedback
│   │   ├── prompts.ts        # System prompt + AI prompt handlers
│   │   ├── memories.ts       # Memory list + generation trigger
│   │   ├── settings.ts       # Pushover + webhook config
│   │   ├── notifications.ts  # Notification history
│   │   ├── wrapups.ts        # Wrapup report list
│   │   ├── stats.ts          # Dashboard summary + timeseries
│   │   ├── sender-profiles.ts # Sender/domain profile handlers
│   │   ├── prompt-wizard.ts  # Wizard start + continue
│   │   └── export-import.ts  # Data export/import
│   ├── pipeline/
│   │   ├── processor.ts      # 2-stage email processing
│   │   └── actions.ts        # Gmail label/archive actions
│   ├── services/
│   │   ├── gmail.ts          # Gmail API client (REST, no SDK)
│   │   ├── openai.ts         # OpenAI API client with structured output
│   │   ├── pushover.ts       # Pushover HTTP client
│   │   └── webhook.ts        # Webhook HTTP client
│   ├── db/
│   │   ├── client.ts         # D1 query helpers
│   │   ├── users.ts          # User queries
│   │   ├── emails.ts         # Email queries
│   │   ├── labels.ts         # Label queries
│   │   ├── prompts.ts        # System prompt + AI prompt queries
│   │   ├── memories.ts       # Memory queries
│   │   ├── sender-profiles.ts # Sender profile queries
│   │   ├── notifications.ts  # Notification queries
│   │   ├── wrapups.ts        # Wrapup queries
│   │   └── stats.ts          # Stats/analytics queries
│   ├── jobs/
│   │   ├── poll-gmail.ts     # Cron: fetch new emails, enqueue
│   │   ├── wrapups.ts        # Cron: morning/evening wrapups
│   │   └── memory.ts         # Cron: daily/weekly/monthly/yearly memory
│   └── types/
│       ├── env.ts            # Env bindings (D1, Queue, KV, secrets)
│       ├── models.ts         # Database model types
│       └── api.ts            # API request/response types
├── migrations/               # D1 SQL migrations (SQLite syntax)
│   ├── 0001_initial_schema.sql
│   └── ...
├── wrangler.toml             # Workers config: D1 binding, Queue, Cron
├── package.json
├── tsconfig.json
└── vitest.config.ts          # Unit test config
```

## Key Design Decisions

### 1. Authentication: JWT

- Google OAuth flow handled by the Worker (login redirect, callback token exchange)
- On successful OAuth callback, Worker signs a JWT containing `{ userId, email }` using a secret stored in Worker env
- JWT returned as an HttpOnly cookie
- Auth middleware verifies JWT on every API request — no database lookup needed
- OAuth access/refresh tokens stored in D1 `users` table for Gmail API calls
- Token refresh handled on-demand when Gmail API returns 401

**Why JWT over sessions:** No KV or DB lookup per request. Revocation is unnecessary since a JWT only grants access to the user's own mailbox.

**Revoked OAuth tokens:** If a user de-authorizes the app at Google, the JWT remains valid but Gmail API calls will fail. The pipeline and API handlers catch Gmail 401s, and the frontend already redirects to `/auth/login` on 401 responses. No special handling needed.

### 2. Database: D1 (SQLite)

Port all 16 PostgreSQL migrations to SQLite-compatible SQL:

| PostgreSQL | SQLite (D1) |
|---|---|
| `SERIAL PRIMARY KEY` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `JSONB` columns | `TEXT` (store JSON strings) |
| `GIN` indexes | Standard indexes on extracted JSON fields |
| `NOW()` | `datetime('now')` |
| `BOOLEAN DEFAULT FALSE` | `INTEGER DEFAULT 0` |
| `::jsonb` casts | `json()` function |
| `jsonb_build_object()` | Build JSON in application code |
| `ON CONFLICT ... DO UPDATE` | `ON CONFLICT ... DO UPDATE` (same) |
| `EXTRACT(DOW FROM ...)` | `strftime('%w', ...)` |
| `EXTRACT(HOUR FROM ...)` | `strftime('%H', ...)` |
| `DATE_TRUNC('day', ...)` | `date(...)` |
| `INTERVAL '30 days'` | `datetime('now', '-30 days')` |
| `COUNT(*) FILTER (WHERE ...)` | `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` |
| `jsonb_array_elements_text()` | Parse JSON in application code |
| Partial indexes (`WHERE is_active = TRUE`) | Application-level enforcement or standard unique index |

**JSONB aggregation:** PostgreSQL queries that use `jsonb_array_elements_text()` for GROUP BY (label distribution, keyword counts) will be handled in application code — fetch rows, parse JSON arrays in TypeScript, aggregate there. Result sets are user-scoped; for users with very large email histories, stats queries should use date-bounded windows (e.g., last 90 days) to limit memory usage.

**Migration strategy:** Create a single consolidated `0001_initial_schema.sql` for D1 rather than porting all 16 incremental PostgreSQL migrations. The Go version's schema evolved via ALTER TABLE statements, but SQLite's ALTER TABLE is limited (no `ADD COLUMN IF NOT EXISTS`). A fresh consolidated schema is cleaner.

**Import/export:** D1's `batch()` is not an interactive transaction — you cannot interleave reads and writes. The import logic must use `INSERT OR REPLACE` / `INSERT OR IGNORE` patterns exclusively, not check-then-insert.

### 3. Gmail Polling: Cron Trigger + Queue

**Cron Trigger** (`*/5 * * * *`):
1. Fetch all active users from D1
2. For each user, check for new Gmail messages since `last_checked_at`
3. Enqueue each new message as `{ userId, messageId }` to the `email-processing` Queue
4. Update `last_checked_at` checkpoint

**Queue Consumer**:
1. Receive batch of messages (max batch size configurable)
2. For each message:
   - Fetch user from D1
   - Refresh OAuth token if expired
   - Fetch full email from Gmail API
   - Run 2-stage AI pipeline (analyze → actions)
   - Send notifications (Pushover/webhook) if triggered
   - Save results to D1
   - Apply labels/archive via Gmail API
   - Update sender profiles

**Why Queue:** Email processing involves multiple slow API calls (Gmail + OpenAI). Queue consumers have longer execution time limits (15 min) than fetch handlers (30s CPU / 6 min wall clock on paid plan). Built-in retries handle transient failures.

### 4. Scheduled Tasks: Cron Triggers

Each cron trigger fires a `scheduled` event. The handler dispatches based on the cron schedule string:

| Cron | Handler |
|---|---|
| `*/5 * * * *` | `pollGmail()` — check all users for new emails |
| `0 8 * * *` | `morningWrapup()` — summarize emails since 5PM yesterday |
| `0 17 * * *` | `eveningWrapup()` + `dailyMemory()` |
| `0 18 * * 6` | `weeklyMemory()` + `generateAIPrompts()` |
| `0 19 1 * *` | `monthlyMemory()` |
| `0 20 1 1 *` | `yearlyMemory()` |

All cron handlers that make external API calls (wrapups, memory generation) should enqueue work to a second Queue (`background-jobs`) rather than processing inline. The cron handler fetches users and enqueues `{ userId, jobType }` messages. A Queue consumer handles the actual OpenAI calls. This ensures cron handlers complete within the 30-second CPU time limit regardless of user count.

The Gmail polling cron is lightweight (just D1 reads + Gmail list calls + enqueue) and can process users inline until scale demands otherwise.

### 5. Frontend: Same React SPA

The existing React frontend is reused as-is. The API contract (routes, JSON shapes) is identical between the Go and Cloudflare versions. Two serving options:

**Option A — Static asset bindings (recommended for single-deploy):**
- Build frontend, configure `[assets]` in wrangler.toml pointing to the dist directory
- Worker handles API/auth routes; unmatched routes fall through to static assets
- Single `wrangler deploy` deploys everything
- Modern replacement for Workers Sites (which used KV under the hood)

**Option B — Cloudflare Pages + Worker:**
- Frontend deployed separately via Pages
- API Worker at a subdomain or path prefix
- More separation, but adds CORS and routing complexity

We'll use **Option A** for simplicity — matches the current Go approach of embedding the SPA.

### 6. External Service Clients

All external API calls use the Workers `fetch` API directly (no SDKs that depend on Node.js APIs):

- **Gmail API**: REST calls with OAuth bearer token. No `googleapis` SDK (too large, Node.js dependencies). Implement the ~8 methods we need directly.
- **OpenAI API**: REST calls with structured JSON output (response_format). Same prompt templates as Go version, ported to TypeScript.
- **Pushover**: Single POST endpoint, trivial.
- **Webhook**: Single POST with optional custom header, trivial.

### 7. Configuration

All config via `wrangler.toml` and Worker environment:

```toml
[vars]
OPENAI_MODEL = "gpt-4o-nano"
SERVER_URL = "https://your-worker.your-subdomain.workers.dev"

# Secrets (set via `wrangler secret put`):
# GOOGLE_CLIENT_ID
# GOOGLE_CLIENT_SECRET
# OPENAI_API_KEY
# JWT_SECRET

[[d1_databases]]
binding = "DB"
database_name = "gmail-triage"
database_id = "xxx"

[[queues.producers]]
queue = "email-processing"
binding = "EMAIL_QUEUE"

[[queues.producers]]
queue = "background-jobs"
binding = "BACKGROUND_QUEUE"

[[queues.consumers]]
queue = "email-processing"
max_batch_size = 5
max_retries = 3

[[queues.consumers]]
queue = "background-jobs"
max_batch_size = 1
max_retries = 3

[triggers]
crons = [
  "*/5 * * * *",
  "0 8 * * *",
  "0 17 * * *",
  "0 18 * * 6",
  "0 19 1 * *",
  "0 20 1 1 *"
]
```

## Routes

### OAuth Routes (server-side redirects)

- `GET /auth/login` — redirect to Google OAuth consent
- `GET /auth/callback` — exchange code for token, issue JWT, redirect to `/dashboard`
- `GET /auth/logout` — clear JWT cookie, redirect to `/`

### API Routes

Every API endpoint from the Go version is implemented with the same route and response shape:

- `GET /api/v1/auth/me`
- `GET|POST /api/v1/labels`, `PUT|DELETE /api/v1/labels/:id`
- `GET /api/v1/emails`, `PUT /api/v1/emails/:id/feedback`
- `GET /api/v1/sender-profiles`, `POST /api/v1/sender-profiles/generate`, `PATCH /api/v1/sender-profiles/:id`
- `GET|PUT /api/v1/prompts`, `POST /api/v1/prompts/defaults`
- `GET /api/v1/memories`, `POST /api/v1/memories/generate`, `POST /api/v1/memories/generate-ai-prompts`
- `GET /api/v1/settings`, `PUT /api/v1/settings/pushover`, `PUT /api/v1/settings/webhook`
- `GET /api/v1/notifications`
- `GET /api/v1/wrapups`
- `GET /api/v1/stats/summary`, `GET /api/v1/stats/timeseries`
- `POST /api/v1/prompt-wizard/start`, `POST /api/v1/prompt-wizard/continue`
- `GET /api/v1/export`, `POST /api/v1/import`

## What's the Same

- Frontend React SPA (identical)
- API routes and JSON response shapes
- OAuth scopes (Gmail modify + userinfo.email)
- 2-stage AI pipeline prompts and structured output schemas
- Notification logic (Pushover + webhook, same events)
- Memory consolidation hierarchy (daily → weekly → monthly → yearly)
- Wrapup report generation

## What's Different

| Aspect | Go Version | Cloudflare Version |
|---|---|---|
| Language | Go | TypeScript |
| Database | PostgreSQL | D1 (SQLite) |
| Auth | Cookie sessions | JWT |
| Background jobs | Goroutines + ticker | Cron Triggers + Queues |
| Gmail polling | In-process loop | Cron → Queue |
| Email processing | Synchronous in goroutine | Queue consumer |
| Deployment | Docker / binary | `wrangler deploy` |
| Frontend serving | `go:embed` | Workers Sites |
| Session storage | Cookie (gorilla/sessions) | JWT in HttpOnly cookie |
| Config | `.env` file | `wrangler.toml` + secrets |

## Local Development

```bash
cd cloudflare
npm install
npm run dev          # wrangler dev with local D1, Queue simulation
npm run migrate      # wrangler d1 migrations apply --local
npm run deploy       # wrangler deploy
```

`wrangler dev` provides local D1 (SQLite file), local Queue simulation, and the ability to trigger cron handlers via `curl http://localhost:8787/__scheduled`. The frontend dev server (`cd frontend && npm run dev`) proxies API calls to the Worker dev server.

## Error Handling

- **Queue consumers:** Process messages serially within a batch. On failure, the message is retried (up to `max_retries`). After exhausting retries, the message is dropped and the error logged. One failed email should not block others in the batch.
- **Cron handlers:** Errors for one user are logged and skipped; processing continues to the next user. The cron handler itself always succeeds (returns 200) to avoid Cloudflare disabling it.
- **API handlers:** Return structured JSON errors `{ error: "message" }` with appropriate HTTP status codes. Same pattern as the Go version.
- **Gmail 401:** Attempt token refresh. If refresh fails, mark user as inactive and skip.
- **OpenAI failures:** Retry once in Queue consumer (built-in retry). API-triggered generation (manual memory/wrapup) returns error to frontend.

## Non-Goals

- Feature parity with future Go features not yet implemented
- Multi-region D1 (single region is fine for now)
- Edge caching of API responses
- WebSocket support
