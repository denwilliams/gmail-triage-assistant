# Cloudflare Workers Gmail Triage Assistant — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully Cloudflare-native version of the Gmail Triage Assistant in `cloudflare/` using Workers, D1, Queues, and Cron Triggers.

**Architecture:** TypeScript Worker with D1 database, JWT auth, two Queues (email-processing + background-jobs), Cron Triggers for polling and scheduled tasks. Same React frontend served via static asset bindings.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), Queues, Cron Triggers, Hono (lightweight router), jose (JWT)

**Spec:** `docs/superpowers/specs/2026-03-13-cloudflare-workers-design.md`

---

## Chunk 1: Project Scaffold & Database

### Task 1: Project Setup

**Files:**
- Create: `cloudflare/package.json`
- Create: `cloudflare/tsconfig.json`
- Create: `cloudflare/wrangler.toml`
- Create: `cloudflare/src/index.ts`
- Create: `cloudflare/src/types/env.ts`

- [ ] **Step 1: Initialize the cloudflare directory**

```bash
cd cloudflare
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install hono jose
npm install -D wrangler typescript @cloudflare/workers-types vitest
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create wrangler.toml**

```toml
name = "gmail-triage-assistant"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[assets]
directory = "../frontend/dist"

[[d1_databases]]
binding = "DB"
database_name = "gmail-triage"
database_id = "placeholder"

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

- [ ] **Step 5: Create env types**

Create `cloudflare/src/types/env.ts`:

```typescript
export interface Env {
  DB: D1Database;
  EMAIL_QUEUE: Queue;
  BACKGROUND_QUEUE: Queue;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_BASE_URL: string;
  JWT_SECRET: string;
  SERVER_URL: string;
}
```

- [ ] **Step 6: Create minimal Worker entry point**

Create `cloudflare/src/index.ts`:

```typescript
import { Hono } from 'hono';
import type { Env } from './types/env';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/v1/health', (c) => c.json({ status: 'ok' }));

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    // TODO: cron handlers
  },
  queue: async (batch: MessageBatch, env: Env, ctx: ExecutionContext) => {
    // TODO: queue consumers
  },
};
```

- [ ] **Step 7: Add scripts to package.json**

Add to `cloudflare/package.json`:
```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "migrate": "wrangler d1 migrations apply gmail-triage --local",
    "migrate:prod": "wrangler d1 migrations apply gmail-triage --remote",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 8: Verify typecheck passes**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add cloudflare/
git commit -m "feat(cloudflare): scaffold project with wrangler, hono, and D1 config"
```

---

### Task 2: D1 Database Schema

**Files:**
- Create: `cloudflare/migrations/0001_initial_schema.sql`

Create a single consolidated migration with all tables. Port from the Go version's 16 incremental PostgreSQL migrations into one SQLite-compatible schema.

- [ ] **Step 1: Write the consolidated migration**

Create `cloudflare/migrations/0001_initial_schema.sql`:

```sql
-- Users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE NOT NULL,
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    token_expiry TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    pushover_user_key TEXT NOT NULL DEFAULT '',
    pushover_app_token TEXT NOT NULL DEFAULT '',
    webhook_url TEXT NOT NULL DEFAULT '',
    webhook_header_key TEXT NOT NULL DEFAULT '',
    webhook_header_value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Emails
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    from_address TEXT NOT NULL,
    from_domain TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    slug TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    labels_applied TEXT NOT NULL DEFAULT '[]',
    bypassed_inbox INTEGER NOT NULL DEFAULT 0,
    reasoning TEXT NOT NULL DEFAULT '',
    human_feedback TEXT NOT NULL DEFAULT '',
    feedback_dirty INTEGER NOT NULL DEFAULT 0,
    notification_sent INTEGER NOT NULL DEFAULT 0,
    processed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_user_processed ON emails(user_id, processed_at);
CREATE INDEX IF NOT EXISTS idx_emails_user_from ON emails(user_id, from_address);
CREATE INDEX IF NOT EXISTS idx_emails_user_slug ON emails(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_emails_user_from_domain ON emails(user_id, from_domain);

-- Labels
CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
);

-- System Prompts
CREATE TABLE IF NOT EXISTS system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, type)
);

-- AI Prompts (versioned, auto-generated supplements)
CREATE TABLE IF NOT EXISTS ai_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_user_type ON ai_prompts(user_id, type, version);

-- Memories
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    reasoning TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type, start_date);

-- Sender Profiles
CREATE TABLE IF NOT EXISTS sender_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    profile_type TEXT NOT NULL,
    identifier TEXT NOT NULL,
    email_count INTEGER NOT NULL DEFAULT 0,
    emails_archived INTEGER NOT NULL DEFAULT 0,
    emails_notified INTEGER NOT NULL DEFAULT 0,
    slug_counts TEXT NOT NULL DEFAULT '{}',
    label_counts TEXT NOT NULL DEFAULT '{}',
    keyword_counts TEXT NOT NULL DEFAULT '{}',
    sender_type TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    modified_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, profile_type, identifier)
);

-- Wrapup Reports
CREATE TABLE IF NOT EXISTS wrapup_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    report_type TEXT NOT NULL,
    content TEXT NOT NULL,
    email_count INTEGER NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wrapups_user ON wrapup_reports(user_id, generated_at);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email_id TEXT NOT NULL REFERENCES emails(id),
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, sent_at);
```

- [ ] **Step 2: Run migration locally**

```bash
cd cloudflare && npm run migrate
```

- [ ] **Step 3: Commit**

```bash
git add cloudflare/migrations/
git commit -m "feat(cloudflare): add consolidated D1 schema migration"
```

---

### Task 3: Database Query Layer

**Files:**
- Create: `cloudflare/src/db/users.ts`
- Create: `cloudflare/src/db/emails.ts`
- Create: `cloudflare/src/db/labels.ts`
- Create: `cloudflare/src/db/prompts.ts`
- Create: `cloudflare/src/db/memories.ts`
- Create: `cloudflare/src/db/sender-profiles.ts`
- Create: `cloudflare/src/db/notifications.ts`
- Create: `cloudflare/src/db/wrapups.ts`
- Create: `cloudflare/src/db/stats.ts`
- Create: `cloudflare/src/types/models.ts`

Port all database queries from Go to TypeScript. Key differences from Go version:
- All JSON columns (`keywords`, `labels_applied`, `slug_counts`, etc.) are stored as TEXT and must be `JSON.parse()`/`JSON.stringify()` in TypeScript
- Use `datetime('now')` instead of `NOW()`
- Boolean columns are INTEGER (0/1), map to boolean in TypeScript
- Stats queries that used `FILTER (WHERE ...)` use `SUM(CASE WHEN ... THEN 1 ELSE 0 END)`
- Stats queries that used `jsonb_array_elements_text()` must fetch rows and aggregate in TypeScript
- The complex `GetRecentMemoriesForContext` UNION ALL query should be split into 4 separate queries (1 yearly, 1 monthly, 1 weekly, 7 daily) and merged in TypeScript

Reference the Go source files for exact query logic:
- `internal/database/users.go` — user CRUD, token updates, active user queries
- `internal/database/emails.go` — email CRUD, feedback, date range queries, dirty feedback
- `internal/database/labels.go` — label CRUD with JSON reasons
- `internal/database/prompts.go` — system prompt upsert/get, default prompt initialization
- `internal/database/ai_prompts.go` — versioned AI prompt create/get
- `internal/database/memories.go` — memory CRUD, context loading, date range queries
- `internal/database/sender_profiles.go` — upsert with JSON counters, stale cleanup, historical email lookup
- `internal/database/notifications.go` — notification create/list
- `internal/database/wrapups.go` — wrapup create/list
- `internal/database/stats.go` — dashboard summary (top senders/domains/slugs/labels/keywords, rates) and timeseries (daily volume, bypass rate, notifications, label trends, hourly heatmap)
- `internal/database/export_import.go` — full data export/import

The model types file should define TypeScript interfaces matching the Go structs in `internal/database/models.go`.

Each db file should export functions that take `D1Database` as first param and return typed results.

- [ ] **Step 1: Create model types**

Create `cloudflare/src/types/models.ts` with interfaces for: User, Email, Label, SystemPrompt, AIPrompt, Memory, SenderProfile, Notification, WrapupReport. Match the Go struct field names but use camelCase. Include helper types for stats (SenderStatItem, DomainStatItem, SlugStatItem, LabelStatItem, KeywordStatItem, DashboardSummary, DashboardTimeseries, DayCount, DayRate, DayLabelCount, HourCount).

- [ ] **Step 2: Create users.ts**

Functions: `getUserByGoogleID`, `createUser`, `updateUserToken`, `getAllActiveUsers`, `getActiveUsers`, `getUserByID`, `updateLastCheckedAt`, `updatePushoverConfig`, `updateWebhookConfig`.

The token fields (access_token, refresh_token, token_expiry) are stored as plain TEXT in D1.

- [ ] **Step 3: Create emails.ts**

Functions: `emailExists`, `createEmail`, `getRecentEmails`, `updateEmailFeedback`, `getEmailsByDateRange`, `getEmailsWithDirtyFeedback`, `clearFeedbackDirty`.

JSON columns `keywords` and `labels_applied` are stored as TEXT — `JSON.stringify()` on write, `JSON.parse()` on read.

- [ ] **Step 4: Create labels.ts**

Functions: `getLabels`, `getLabelsWithDetails`, `createLabel`, `updateLabel`, `deleteLabel`, `getAllLabels`.

The `reasons` column is JSON TEXT — parse on read, stringify on write.

- [ ] **Step 5: Create prompts.ts**

Functions: `getSystemPrompt`, `upsertSystemPrompt`, `getAllSystemPrompts`, `initDefaultPrompts`, `getLatestAIPrompt`, `createAIPrompt`, `getLatestAIPrompts`.

Default prompts should match the Go version's defaults in `internal/database/prompts.go`. The AI prompt version auto-increments: query `MAX(version)` for user+type, then insert with version+1.

- [ ] **Step 6: Create memories.ts**

Functions: `createMemory`, `getMemoriesByType`, `getAllMemories`, `getRecentMemoriesForContext`, `getMemoriesByDateRange`.

`getRecentMemoriesForContext` — run 4 separate queries (1 yearly LIMIT 1, 1 monthly LIMIT 1, 1 weekly LIMIT 1, daily LIMIT 7), combine results in TypeScript sorted by type priority then date.

- [ ] **Step 7: Create sender-profiles.ts**

Functions: `getSenderProfile`, `getSenderProfileByID`, `upsertSenderProfile`, `deleteStaleProfiles`, `getHistoricalEmailsFromAddress`, `getHistoricalEmailsFromDomain`, `updateSenderProfile`.

JSON counter columns (`slug_counts`, `label_counts`, `keyword_counts`) are TEXT — parse/stringify in code.

- [ ] **Step 8: Create notifications.ts**

Functions: `createNotification`, `getNotifications`.

- [ ] **Step 9: Create wrapups.ts**

Functions: `createWrapupReport`, `getWrapupReports`.

- [ ] **Step 10: Create stats.ts**

Functions: `getDashboardSummary`, `getDashboardTimeseries`.

Port the PostgreSQL stats queries to SQLite:
- Replace `COUNT(*) FILTER (WHERE x)` with `SUM(CASE WHEN x THEN 1 ELSE 0 END)`
- Replace `EXTRACT(DOW FROM x)` with `CAST(strftime('%w', x) AS INTEGER)`
- Replace `EXTRACT(HOUR FROM x)` with `CAST(strftime('%H', x) AS INTEGER)`
- Replace `DATE_TRUNC('day', x)` with `date(x)`
- For label distribution and keyword counts: query raw emails with their JSON arrays, then parse and aggregate in TypeScript. Limit to last 90 days to bound memory usage.
- For label trends: same approach — fetch emails in date range, parse `labels_applied` JSON, aggregate by date+label in TypeScript.

- [ ] **Step 11: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 12: Commit**

```bash
git add cloudflare/src/db/ cloudflare/src/types/models.ts
git commit -m "feat(cloudflare): add D1 database query layer"
```

---

## Chunk 2: Auth & External Services

### Task 4: JWT Authentication

**Files:**
- Create: `cloudflare/src/auth/jwt.ts`
- Create: `cloudflare/src/auth/oauth.ts`

- [ ] **Step 1: Create JWT utilities**

Create `cloudflare/src/auth/jwt.ts`:
- `signJWT(payload: { userId: number; email: string }, secret: string): Promise<string>` — sign with `jose`, 7-day expiry, HS256
- `verifyJWT(token: string, secret: string): Promise<{ userId: number; email: string }>` — verify and return payload
- `authMiddleware` — Hono middleware that reads JWT from `auth` cookie, verifies, sets `userId` and `email` on context. Returns 401 JSON if invalid/missing.

- [ ] **Step 2: Create OAuth handlers**

Create `cloudflare/src/auth/oauth.ts`:
- `handleLogin(c)` — Redirect to Google OAuth consent URL. Scopes: `gmail.modify` + `userinfo.email`. Include `access_type=offline` and `prompt=consent` to get refresh token.
- `handleCallback(c)` — Exchange code for token via Google token endpoint (direct `fetch`, not SDK). Fetch user info from `https://www.googleapis.com/oauth2/v2/userinfo`. Create or update user in D1. Sign JWT. Set as HttpOnly cookie. Redirect to `/dashboard`.
- `handleLogout(c)` — Clear auth cookie. Redirect to `/`.

Google OAuth token exchange is a POST to `https://oauth2.googleapis.com/token` with form-encoded body (grant_type, code, client_id, client_secret, redirect_uri).

- [ ] **Step 3: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add cloudflare/src/auth/
git commit -m "feat(cloudflare): add JWT auth and Google OAuth flow"
```

---

### Task 5: External Service Clients

**Files:**
- Create: `cloudflare/src/services/gmail.ts`
- Create: `cloudflare/src/services/openai.ts`
- Create: `cloudflare/src/services/pushover.ts`
- Create: `cloudflare/src/services/webhook.ts`

- [ ] **Step 1: Create Gmail client**

Create `cloudflare/src/services/gmail.ts`:

All methods use `fetch()` with Bearer token auth against `https://gmail.googleapis.com/gmail/v1/users/me/...`.

Methods to implement (reference `internal/gmail/client.go`):
- `getMessagesSince(token, since, maxResults)` — List messages with query `in:inbox`, filter by internalDate > since. For each message ID, fetch full message.
- `getMessage(token, messageId)` — GET message with format=full. Parse headers for Subject and From. Extract body: recursively find first `text/plain` part, base64url-decode the `data` field.
- `addLabels(token, messageId, labelIds)` — POST to `/messages/{id}/modify` with `addLabelIds`.
- `archiveMessage(token, messageId)` — POST to `/messages/{id}/modify` with `removeLabelIds: ["INBOX"]`.
- `listLabels(token)` — GET `/labels`.
- `getLabelId(token, labelName)` — Find label by name from listLabels result.
- `createLabel(token, labelName)` — POST `/labels` with name and visibility settings.
- `sendMessage(token, to, subject, body)` — POST `/messages/send` with base64url-encoded RFC 5322 message.

Include `refreshToken(env, refreshToken)` — POST to `https://oauth2.googleapis.com/token` with `grant_type=refresh_token`. Returns new access_token. Update user in D1 on success.

Helper: `parseAddress(raw)` — extract email from `"Name <email@example.com>"` format.

- [ ] **Step 2: Create OpenAI client**

Create `cloudflare/src/services/openai.ts`:

All methods use `fetch()` against `${OPENAI_BASE_URL}/chat/completions`.

Methods to implement (reference `internal/openai/client.go` and `internal/openai/wizard.go`):
- `analyzeEmail(env, from, subject, body, senderContext, customPrompt)` — Structured output with JSON schema for `{ slug, keywords[], summary }`. Use the same system prompts and user prompt format as the Go version.
- `determineActions(env, from, subject, slug, keywords, summary, labelNames, formattedLabels, senderContext, memoryContext, customPrompt)` — Structured output for `{ labels[], bypass_inbox, notification_message, reasoning }`. The `labels` field uses an enum constraint with the actual label names.
- `generateMemoryWithReasoning(env, systemPrompt, userPrompt)` — Structured output for `{ content, reasoning }`.
- `generateMemory(env, systemPrompt, userPrompt)` — Plain text completion (no structured output). Used for AI prompt generation and wrapup summaries.
- `bootstrapSenderProfile(env, identifier, emails)` — Structured output for `{ sender_type, summary }`.
- `evolveProfileSummary(env, currentSummary, senderType, update)` — Structured output for `{ sender_type, summary }`.
- `runPromptWizard(env, systemPrompt, userPrompt)` — Structured output for `{ done, message, questions[], prompts }`.

For structured output, use `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`.

- [ ] **Step 3: Create Pushover client**

Create `cloudflare/src/services/pushover.ts`:
- `sendPushover(userKey, appToken, title, message)` — POST to `https://api.pushover.net/1/messages.json` with form-encoded body.

- [ ] **Step 4: Create Webhook client**

Create `cloudflare/src/services/webhook.ts`:

```typescript
interface WebhookPayload {
  title: string;
  message: string;
  from_address: string;
  email_id: string;
  slug: string;
  subject: string;
  labels_applied: string[];
  processed_at: string;
}
```

- `sendWebhook(url, headerKey, headerValue, payload)` — POST JSON to URL with optional custom header. Validate URL scheme (http/https only). 10-second timeout via AbortController.

- [ ] **Step 5: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add cloudflare/src/services/
git commit -m "feat(cloudflare): add Gmail, OpenAI, Pushover, and Webhook clients"
```

---

## Chunk 3: API Handlers

### Task 6: API Route Handlers

**Files:**
- Create: `cloudflare/src/router.ts`
- Create: `cloudflare/src/api/labels.ts`
- Create: `cloudflare/src/api/emails.ts`
- Create: `cloudflare/src/api/prompts.ts`
- Create: `cloudflare/src/api/memories.ts`
- Create: `cloudflare/src/api/settings.ts`
- Create: `cloudflare/src/api/notifications.ts`
- Create: `cloudflare/src/api/wrapups.ts`
- Create: `cloudflare/src/api/stats.ts`
- Create: `cloudflare/src/api/sender-profiles.ts`
- Create: `cloudflare/src/api/prompt-wizard.ts`
- Create: `cloudflare/src/api/export-import.ts`
- Modify: `cloudflare/src/index.ts`

Port all API handlers from `internal/web/api_handlers.go` and `internal/web/wizard.go`. Each handler is a thin layer that validates input, calls db functions, and returns JSON.

- [ ] **Step 1: Create router with auth middleware**

Create `cloudflare/src/router.ts` — Hono app with:
- Auth routes (no middleware): `GET /auth/login`, `GET /auth/callback`, `GET /auth/logout`
- API routes (with JWT middleware): all `/api/v1/*` routes
- Each API route calls the corresponding handler function

- [ ] **Step 2: Create label handlers**

Reference: `handleAPIGetLabels`, `handleAPICreateLabel`, `handleAPIUpdateLabel`, `handleAPIDeleteLabel` in `internal/web/api_handlers.go`.

- `GET /api/v1/labels` → return all labels for user
- `POST /api/v1/labels` → create label with name + description
- `PUT /api/v1/labels/:id` → update label name, description, reasons
- `DELETE /api/v1/labels/:id` → delete label

- [ ] **Step 3: Create email handlers**

Reference: `handleAPIGetEmails`, `handleAPIUpdateFeedback` in `internal/web/api_handlers.go`.

- `GET /api/v1/emails?limit=50&offset=0` → return recent emails with JSON-parsed keywords and labels_applied
- `PUT /api/v1/emails/:id/feedback` → update human_feedback, set feedback_dirty

- [ ] **Step 4: Create prompt handlers**

Reference: `handleAPIGetPrompts`, `handleAPIUpdatePrompt`, `handleAPIInitDefaults` in `internal/web/api_handlers.go`.

- `GET /api/v1/prompts` → return all system prompts + latest AI prompts (email_analyze, email_actions)
- `PUT /api/v1/prompts` → upsert system prompt by type
- `POST /api/v1/prompts/defaults` → initialize default system prompts

- [ ] **Step 5: Create memory handlers**

Reference: `handleAPIGetMemories`, `handleAPIGenerateMemory`, `handleAPIGenerateAIPrompts` in `internal/web/api_handlers.go`.

- `GET /api/v1/memories?limit=100` → return memories ordered by start_date DESC
- `POST /api/v1/memories/generate` → trigger daily memory generation (calls memory service)
- `POST /api/v1/memories/generate-ai-prompts` → trigger AI prompt generation

- [ ] **Step 6: Create settings handlers**

Reference: `handleAPIGetSettings`, `handleAPIUpdatePushover`, `handleAPIUpdateWebhook` in `internal/web/api_handlers.go`.

- `GET /api/v1/settings` → return pushover + webhook config (mask webhook header value)
- `PUT /api/v1/settings/pushover` → update pushover user key + app token
- `PUT /api/v1/settings/webhook` → update webhook URL + header key/value

- [ ] **Step 7: Create notification, wrapup, stats handlers**

- `GET /api/v1/notifications?limit=50` → return recent notifications
- `GET /api/v1/wrapups?limit=30` → return recent wrapup reports
- `GET /api/v1/stats/summary` → return dashboard summary
- `GET /api/v1/stats/timeseries?days=30` → return timeseries data

- [ ] **Step 8: Create sender profile handlers**

Reference: `handleAPIGetSenderProfiles`, `handleAPIGenerateSenderProfile`, `handleAPIUpdateSenderProfile` in `internal/web/api_handlers.go`.

- `GET /api/v1/sender-profiles?address=x` → return sender + domain profiles
- `POST /api/v1/sender-profiles/generate` → bootstrap or regenerate a sender/domain profile using AI
- `PATCH /api/v1/sender-profiles/:id` → update summary or label_counts

- [ ] **Step 9: Create prompt wizard handlers**

Reference: `internal/web/wizard.go` for `handleAPIPromptWizardStart` and `handleAPIPromptWizardContinue`.

- `POST /api/v1/prompt-wizard/start` → fetch 2 weeks of emails + labels + prompts, build email summary, call OpenAI wizard, return first questions
- `POST /api/v1/prompt-wizard/continue` → receive history + email_summary, build conversation prompt, call OpenAI wizard, return more questions or final prompts

Port `buildWizardEmailSummary` and `buildWizardConversationPrompt` from the Go version.

- [ ] **Step 10: Create export/import handlers**

Reference: `handleAPIExport`, `handleAPIImport` in `internal/web/api_handlers.go` and `internal/database/export_import.go`.

- `GET /api/v1/export?include_emails=true` → query all user data, return as JSON download
- `POST /api/v1/import` → accept JSON body, use `INSERT OR REPLACE` patterns (not interactive transactions)

- [ ] **Step 11: Wire router into index.ts**

Update `cloudflare/src/index.ts` to use the router for fetch handling.

- [ ] **Step 12: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 13: Commit**

```bash
git add cloudflare/src/router.ts cloudflare/src/api/ cloudflare/src/index.ts
git commit -m "feat(cloudflare): add all API route handlers"
```

---

## Chunk 4: Pipeline & Background Jobs

### Task 7: Email Processing Pipeline

**Files:**
- Create: `cloudflare/src/pipeline/processor.ts`
- Create: `cloudflare/src/pipeline/actions.ts`

Port the 2-stage AI pipeline from `internal/pipeline/processor.go`. This runs in the Queue consumer.

- [ ] **Step 1: Create the processor**

Create `cloudflare/src/pipeline/processor.ts`:

`processEmail(env, userId, messageId)`:
1. Fetch user from D1
2. Check if email already processed (dedup)
3. Get OAuth token, refresh if expired
4. Fetch full email from Gmail API
5. Decode body (base64url), truncate to 2000 chars
6. Load system prompts (email_analyze, email_actions) + AI prompt supplements
7. Load memories for context (1 yearly, 1 monthly, 1 weekly, up to 7 daily)
8. Load/bootstrap sender + domain profiles
9. Stage 1: `analyzeEmail()` → slug, keywords, summary
10. Stage 2: `determineActions()` → labels, bypass_inbox, notification_message, reasoning
11. Send Pushover notification if triggered + configured
12. Send webhook notification if triggered + configured
13. Save notification to DB (avoid duplicate if both channels fired)
14. Save email record to D1
15. Apply labels to Gmail (create if missing)
16. Archive if bypass_inbox
17. Update sender + domain profiles (increment counters, evolve summary via AI)

Reference the exact Go flow in `internal/pipeline/processor.go` lines 38-240.

- [ ] **Step 2: Create Gmail actions helper**

Create `cloudflare/src/pipeline/actions.ts`:
- `applyLabelsAndArchive(env, token, messageId, labelNames, bypassInbox)` — resolve label names to IDs (create if needed), add labels, optionally archive.

- [ ] **Step 3: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add cloudflare/src/pipeline/
git commit -m "feat(cloudflare): add email processing pipeline"
```

---

### Task 8: Cron Jobs & Queue Consumers

**Files:**
- Create: `cloudflare/src/jobs/poll-gmail.ts`
- Create: `cloudflare/src/jobs/wrapups.ts`
- Create: `cloudflare/src/jobs/memory.ts`
- Modify: `cloudflare/src/index.ts`

- [ ] **Step 1: Create Gmail polling job**

Create `cloudflare/src/jobs/poll-gmail.ts`:

`pollGmail(env)`:
1. Fetch all active users from D1
2. For each user:
   - Get OAuth token, refresh if expired
   - Fetch messages since `last_checked_at` via Gmail API
   - For each new message: enqueue `{ userId, messageId }` to `EMAIL_QUEUE`
   - Update `last_checked_at` to newest message timestamp
3. Errors for one user are logged and skipped

- [ ] **Step 2: Create wrapup jobs**

Create `cloudflare/src/jobs/wrapups.ts`:

Port from `internal/wrapup/service.go`:
- `runMorningWrapup(env, userId)` — emails since 5PM yesterday, build stats + AI summary, save report
- `runEveningWrapup(env, userId)` — emails since 8AM today, same flow
- `buildWrapupStats(emails, reportType)` — format ASCII table with sender/label/slug counts
- `generateAISummary(env, emails, reportType)` — call OpenAI for 1-2 sentence summary

These run in the `background-jobs` Queue consumer, not inline in the cron handler.

- [ ] **Step 3: Create memory jobs**

Create `cloudflare/src/jobs/memory.ts`:

Port from `internal/memory/service.go`:
- `generateDailyMemory(env, userId)` — yesterday's emails + dirty feedback → AI memory
- `generateWeeklyMemory(env, userId)` — consolidate daily memories from past week
- `generateMonthlyMemory(env, userId)` — consolidate weekly memories
- `generateYearlyMemory(env, userId)` — consolidate monthly memories
- `generateAIPrompts(env, userId)` — generate email_analyze and email_actions supplements from weekly memory

Include the exact system prompts from the Go version (daily review, weekly/monthly/yearly consolidation, AI prompt meta-prompt). Reference `internal/memory/service.go` for the full prompt text.

- [ ] **Step 4: Wire up scheduled and queue handlers in index.ts**

Update `cloudflare/src/index.ts`:

```typescript
scheduled: async (event, env, ctx) => {
  const users = await getAllActiveUsers(env.DB);
  switch (event.cron) {
    case '*/5 * * * *':
      await pollGmail(env);
      break;
    case '0 8 * * *':
      for (const user of users) {
        await env.BACKGROUND_QUEUE.send({ userId: user.id, jobType: 'morning_wrapup' });
      }
      break;
    case '0 17 * * *':
      for (const user of users) {
        await env.BACKGROUND_QUEUE.send({ userId: user.id, jobType: 'evening_wrapup' });
        await env.BACKGROUND_QUEUE.send({ userId: user.id, jobType: 'daily_memory' });
      }
      break;
    case '0 18 * * 6':
      for (const user of users) {
        await env.BACKGROUND_QUEUE.send({ userId: user.id, jobType: 'weekly_memory' });
      }
      break;
    case '0 19 1 * *':
      for (const user of users) {
        await env.BACKGROUND_QUEUE.send({ userId: user.id, jobType: 'monthly_memory' });
      }
      break;
    case '0 20 1 1 *':
      for (const user of users) {
        await env.BACKGROUND_QUEUE.send({ userId: user.id, jobType: 'yearly_memory' });
      }
      break;
  }
},
queue: async (batch, env, ctx) => {
  for (const msg of batch.messages) {
    try {
      const data = msg.body as any;
      if (data.messageId) {
        // email-processing queue
        await processEmail(env, data.userId, data.messageId);
      } else if (data.jobType) {
        // background-jobs queue
        switch (data.jobType) {
          case 'morning_wrapup': await runMorningWrapup(env, data.userId); break;
          case 'evening_wrapup': await runEveningWrapup(env, data.userId); break;
          case 'daily_memory': await generateDailyMemory(env, data.userId); break;
          case 'weekly_memory':
            await generateWeeklyMemory(env, data.userId);
            await generateAIPrompts(env, data.userId);
            break;
          case 'monthly_memory': await generateMonthlyMemory(env, data.userId); break;
          case 'yearly_memory': await generateYearlyMemory(env, data.userId); break;
        }
      }
      msg.ack();
    } catch (e) {
      console.error('Queue message failed:', e);
      msg.retry();
    }
  }
},
```

- [ ] **Step 5: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add cloudflare/src/jobs/ cloudflare/src/index.ts
git commit -m "feat(cloudflare): add cron jobs and queue consumers"
```

---

## Chunk 5: Frontend Integration & Polish

### Task 9: Frontend Build Integration

**Files:**
- Modify: `cloudflare/wrangler.toml` (if needed)
- Modify: `cloudflare/package.json`

- [ ] **Step 1: Build frontend and verify static assets config**

The frontend is already built at `../frontend/dist/`. The `wrangler.toml` `[assets]` section points to it. Verify:

```bash
cd frontend && npm run build
cd ../cloudflare && npx wrangler dev
```

The Worker should serve the SPA for non-API routes and handle API routes via Hono.

- [ ] **Step 2: Handle SPA fallback in the router**

Ensure that Hono returns a 404 for unknown `/api/*` routes (so they don't fall through to the SPA), but lets all other routes serve the frontend's `index.html` for client-side routing.

With Cloudflare static assets, unmatched routes automatically serve from the assets directory. The `[assets]` config handles this. Verify SPA routing works (e.g., `/dashboard`, `/settings` all serve `index.html`).

- [ ] **Step 3: Add combined build script**

Add to `cloudflare/package.json`:
```json
{
  "scripts": {
    "build": "cd ../frontend && npm run build",
    "dev": "wrangler dev",
    "deploy": "npm run build && wrangler deploy"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add cloudflare/
git commit -m "feat(cloudflare): integrate frontend build and SPA serving"
```

---

### Task 10: API Response Types Alignment

**Files:**
- Create: `cloudflare/src/types/api.ts`

Ensure all API responses exactly match the Go version's JSON shapes so the existing frontend works without changes.

- [ ] **Step 1: Create API response type file**

Create `cloudflare/src/types/api.ts` defining the exact response shapes the frontend expects. Cross-reference `frontend/src/lib/types.ts` for the expected interfaces:
- Labels: `{ id, user_id, name, reasons: string[], description, created_at, updated_at }`
- Emails: `{ id, user_id, from_address, subject, slug, keywords: string[], summary, labels_applied: string[], bypassed_inbox: boolean, notification_sent: boolean, reasoning, human_feedback, feedback_dirty: boolean, processed_at, created_at }`
- Settings: `{ pushover_user_key, pushover_configured: boolean, webhook_url, webhook_header_key, webhook_header_value, webhook_configured: boolean }`
- Prompts: `{ prompts: SystemPrompt[], ai_analyze: AIPrompt|null, ai_actions: AIPrompt|null }`
- etc.

Key gotchas:
- D1 stores booleans as 0/1 — API must return actual `true`/`false`
- D1 stores JSON arrays as strings — API must return parsed arrays
- `user_id` fields use snake_case in JSON (match Go's json tags)

- [ ] **Step 2: Audit all handlers for response shape correctness**

Go through each handler and verify the JSON output matches what the frontend expects. Pay special attention to:
- Boolean conversion (SQLite INTEGER → JSON boolean)
- JSON array parsing (TEXT → JSON array)
- Null handling (Go returns empty array `[]` not `null` for empty slices)
- Date format consistency (Go uses RFC3339)

- [ ] **Step 3: Typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add cloudflare/src/types/api.ts
git commit -m "feat(cloudflare): add API response types and alignment"
```

---

### Task 11: End-to-End Verification

- [ ] **Step 1: Run local D1 migration**

```bash
cd cloudflare && npm run migrate
```

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npm run build
```

- [ ] **Step 3: Start dev server**

```bash
cd cloudflare && npm run dev
```

- [ ] **Step 4: Verify health endpoint**

```bash
curl http://localhost:8787/api/v1/health
```

- [ ] **Step 5: Verify SPA serving**

Open `http://localhost:8787` in browser — should see the React app login page.

- [ ] **Step 6: Verify OAuth flow**

Navigate to `/auth/login` — should redirect to Google consent. (Requires valid Google OAuth credentials in `.dev.vars`.)

- [ ] **Step 7: Verify API endpoints return correct shapes**

After login, check:
- `/api/v1/labels` — returns `[]`
- `/api/v1/emails` — returns `[]`
- `/api/v1/settings` — returns settings object with boolean fields
- `/api/v1/prompts` — returns prompts response

- [ ] **Step 8: Final typecheck**

```bash
cd cloudflare && npm run typecheck
```

- [ ] **Step 9: Commit any fixes**

```bash
git add cloudflare/
git commit -m "fix(cloudflare): end-to-end verification fixes"
```
