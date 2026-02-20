# Cloudflare TypeScript Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the Gmail Triage Assistant in TypeScript as a Cloudflare Workers app, replacing the persistent Go server with a fully serverless architecture.

**Architecture:**
- Hono.js for HTTP routing (Workers-native, tiny)
- Cloudflare D1 (SQLite) for the database — JSON arrays stored as TEXT
- Cloudflare KV for session tokens
- Gmail Push Notifications via Google Cloud Pub/Sub → **Cloudflare Queue** (push webhook enqueues, separate Queue consumer processes)
- Cloudflare Cron Triggers (replaces the Go scheduler goroutine)
- Direct Google REST API calls via fetch (no googleapis npm package — too heavy)

**Why Queues for email processing:**
The API worker (push webhook) must return 200 to Pub/Sub within seconds or Google retries the notification. Email processing involves 2 OpenAI calls + Gmail API calls + DB writes — too slow and too likely to hit CPU limits in an API worker. The Queue consumer gets up to 15 minutes per batch, automatic retries, and independent scaling. The push webhook simply enqueues `{userId, messageId}` and returns immediately.

**Tech Stack:**
- `hono` for routing, `@hono/html` for template helpers
- `openai` npm SDK for AI calls
- `wrangler` CLI for deployment and local dev
- `vitest` + `@cloudflare/vitest-pool-workers` for unit tests

**Worktree:** `.worktrees/cloudflare-ts` on branch `cloudflare-ts`

---

## Key Architecture Decisions

### Session Management (replacing gorilla/sessions)
Store a random UUID session token in a secure cookie. Look it up in KV:
- KV key: `session:{token}` → `{userId: number, email: string}`
- TTL: 7 days (604800 seconds)

### Database (replacing PostgreSQL + JSONB)
D1 uses SQLite. Arrays (keywords, labels_applied, reasons) stored as JSON strings. Parse/stringify in the DB layer. No GIN indexes — use simple TEXT indexes.

### Gmail Push → Queue (replacing polling goroutine)
After OAuth, call Gmail `users.watch()` API with a Pub/Sub topic. Google sends a POST to `/api/gmail/push` when new email arrives.

**The API worker does NOT process the email.** It only:
1. Parses the Pub/Sub notification to get `{emailAddress, historyId}`
2. Looks up the user
3. Enqueues `{userId, messageId}` to the `email-processing` Queue
4. Returns 200 immediately

The **Queue consumer worker** handles `processEmail()` — it has up to 15 minutes per batch, retries failed messages automatically, and won't block the push webhook from acknowledging Google's notification.

Gmail watch expires every 7 days — renew daily via cron.

### Cron Triggers (replacing Go scheduler)
```
0 8 * * *   → morning wrapup
0 17 * * *  → evening wrapup + daily memory
0 18 * * 6  → weekly memory (Saturday)
0 19 1 * *  → monthly memory (1st of month)
0 20 1 1 *  → yearly memory (January 1st)
0 9 * * *   → renew Gmail watch (daily)
```

### HTML Templates (replacing Go html/template)
TypeScript template literal functions. HTMX and Pico CSS stay identical — just the rendering changes from Go templates to TS functions.

---

## Environment Variables (Cloudflare Secrets)

Set these with `wrangler secret put`:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URL` (e.g. `https://your-worker.workers.dev/auth/callback`)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `SESSION_SECRET` (32+ random bytes as hex string)
- `PUBSUB_TOPIC` (e.g. `projects/{project_id}/topics/gmail-triage`)
- `PUBSUB_VERIFICATION_TOKEN` (random string to verify Pub/Sub requests)

---

## Task 1: Init Wrangler project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `src/index.ts` (empty entry point)

**Step 1: Init the project**

```bash
cd /Users/den/Development/home/gmail-triage-assistant/.worktrees/cloudflare-ts
npm init -y
npm install hono openai
npm install -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types
```

**Step 2: Create `wrangler.toml`**

```toml
name = "gmail-triage-assistant"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "gmail-triage"
database_id = "REPLACE_AFTER_CREATE"

[[kv_namespaces]]
binding = "SESSIONS"
id = "REPLACE_AFTER_CREATE"

# Queue: push webhook enqueues here, consumer worker processes async
[[queues.producers]]
queue = "email-processing"
binding = "EMAIL_QUEUE"

[[queues.consumers]]
queue = "email-processing"
max_batch_size = 10        # process up to 10 emails per consumer invocation
max_batch_timeout = 30     # wait up to 30s to fill a batch before processing
max_retries = 3            # retry failed messages up to 3 times

[triggers]
crons = [
  "0 8 * * *",
  "0 17 * * *",
  "0 18 * * 6",
  "0 19 1 * *",
  "0 20 1 1 *",
  "0 9 * * *"
]
```

**Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

**Step 4: Create minimal `src/index.ts`**

```typescript
import { Hono } from 'hono'

export type EmailQueueMessage = {
  userId: number
  messageId: string
}

export type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  EMAIL_QUEUE: Queue<EmailQueueMessage>
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REDIRECT_URL: string
  OPENAI_API_KEY: string
  OPENAI_MODEL: string
  SESSION_SECRET: string
  PUBSUB_TOPIC: string
  PUBSUB_VERIFICATION_TOKEN: string
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => c.text('OK'))

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // cron dispatch goes here
  },
  async queue(batch: MessageBatch<EmailQueueMessage>, env: Env) {
    // queue consumer goes here
  },
}
```

**Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 6: Commit**

```bash
git add package.json tsconfig.json wrangler.toml src/index.ts package-lock.json
git commit -m "chore: init Cloudflare Workers TypeScript project"
```

---

## Task 2: D1 Database Schema

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/migrate.ts`

**Step 1: Create `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  google_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  gmail_history_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  from_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  slug TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL DEFAULT '',
  labels_applied TEXT NOT NULL DEFAULT '[]',
  bypassed_inbox INTEGER NOT NULL DEFAULT 0,
  reasoning TEXT NOT NULL DEFAULT '',
  human_feedback TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_from_address ON emails(from_address);
CREATE INDEX IF NOT EXISTS idx_emails_processed_at ON emails(processed_at);

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

CREATE TABLE IF NOT EXISTS system_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN (
    'email_analyze', 'email_actions', 'daily_review',
    'weekly_summary', 'monthly_summary', 'yearly_summary', 'wrapup_report'
  )),
  content TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('daily', 'weekly', 'monthly', 'yearly')),
  content TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_dates ON memories(start_date, end_date);

CREATE TABLE IF NOT EXISTS wrapup_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  report_type TEXT NOT NULL DEFAULT 'morning',
  email_count INTEGER NOT NULL,
  content TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 2: Apply schema locally for dev**

```bash
wrangler d1 create gmail-triage
# Copy the database_id into wrangler.toml
wrangler d1 execute gmail-triage --local --file=src/db/schema.sql
```

Expected: tables created with no errors.

**Step 3: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat: add D1 database schema"
```

---

## Task 3: TypeScript Types

**Files:**
- Create: `src/types.ts`

**Step 1: Create `src/types.ts`**

```typescript
export type PromptType =
  | 'email_analyze'
  | 'email_actions'
  | 'daily_review'
  | 'weekly_summary'
  | 'monthly_summary'
  | 'yearly_summary'
  | 'wrapup_report'

export type MemoryType = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface User {
  id: number
  email: string
  google_id: string
  access_token: string
  refresh_token: string
  token_expiry: string
  is_active: number
  last_checked_at: string | null
  gmail_history_id: string | null
  created_at: string
  updated_at: string
}

export interface Email {
  id: string
  user_id: number
  from_address: string
  subject: string
  slug: string
  keywords: string[]
  labels_applied: string[]
  summary: string
  bypassed_inbox: boolean
  reasoning: string
  human_feedback: string
  processed_at: string
  created_at: string
}

export interface Label {
  id: number
  user_id: number
  name: string
  reasons: string[]
  description: string
  created_at: string
  updated_at: string
}

export interface SystemPrompt {
  id: number
  user_id: number
  type: PromptType
  content: string
  is_active: number
  description: string
  created_at: string
  updated_at: string
}

export interface Memory {
  id: number
  user_id: number
  type: MemoryType
  content: string
  start_date: string
  end_date: string
  created_at: string
}

export interface WrapupReport {
  id: number
  user_id: number
  report_type: string
  email_count: number
  content: string
  generated_at: string
  created_at: string
}

export interface SessionData {
  userId: number
  email: string
}

// Gmail API raw message (from Google REST API)
export interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  internalDate: string
  payload: {
    headers: { name: string; value: string }[]
    mimeType: string
    body: { data?: string }
    parts?: GmailMessage['payload'][]
  }
}

export interface ParsedMessage {
  id: string
  threadId: string
  subject: string
  from: string
  body: string
  labelIds: string[]
  internalDate: number
}

// AI response types
export interface EmailAnalysis {
  slug: string
  keywords: string[]
  summary: string
}

export interface EmailActions {
  labels: string[]
  bypass_inbox: boolean
  reasoning: string
}
```

**Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TypeScript type definitions"
```

---

## Task 4: DB Layer — Users

**Files:**
- Create: `src/db/users.ts`
- Create: `test/db/users.test.ts`

**Step 1: Write failing test**

```typescript
// test/db/users.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { getUser, getUserByGoogleId, createUser, updateUserToken } from '../../src/db/users'

describe('users db', () => {
  it('creates and retrieves a user', async () => {
    const user = await createUser(env.DB, {
      email: 'test@example.com',
      google_id: 'gid_123',
      access_token: 'acc',
      refresh_token: 'ref',
      token_expiry: new Date().toISOString(),
    })
    expect(user.email).toBe('test@example.com')

    const found = await getUserByGoogleId(env.DB, 'gid_123')
    expect(found?.id).toBe(user.id)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/db/users.test.ts
```

Expected: FAIL (module not found)

**Step 3: Create `src/db/users.ts`**

```typescript
import type { User } from '../types'

type CreateUserInput = {
  email: string
  google_id: string
  access_token: string
  refresh_token: string
  token_expiry: string
}

export async function getUserByGoogleId(db: D1Database, googleId: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first<User>()
}

export async function getUser(db: D1Database, userId: number): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>()
}

export async function getActiveUsers(db: D1Database): Promise<User[]> {
  const result = await db.prepare('SELECT * FROM users WHERE is_active = 1').all<User>()
  return result.results
}

export async function createUser(db: D1Database, input: CreateUserInput): Promise<User> {
  const now = new Date().toISOString()
  const result = await db.prepare(`
    INSERT INTO users (email, google_id, access_token, refresh_token, token_expiry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(input.email, input.google_id, input.access_token, input.refresh_token, input.token_expiry, now, now)
    .first<User>()

  if (!result) throw new Error('Failed to create user')
  return result
}

export async function updateUserToken(
  db: D1Database,
  userId: number,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    UPDATE users SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = ?
    WHERE id = ?
  `).bind(accessToken, refreshToken, tokenExpiry, now, userId).run()
}

export async function updateGmailHistoryId(
  db: D1Database,
  userId: number,
  historyId: string
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    UPDATE users SET gmail_history_id = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(historyId, now, now, userId).run()
}
```

**Step 4: Create vitest config for Workers**

```typescript
// vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
      },
    },
  },
})
```

**Step 5: Run test to verify it passes**

```bash
npx vitest run test/db/users.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/db/users.ts test/db/users.test.ts vitest.config.ts
git commit -m "feat: add users DB layer"
```

---

## Task 5: DB Layer — Emails, Labels, Prompts, Memories, Wrapups

**Files:**
- Create: `src/db/emails.ts`
- Create: `src/db/labels.ts`
- Create: `src/db/prompts.ts`
- Create: `src/db/memories.ts`
- Create: `src/db/wrapups.ts`
- Create: `src/db/index.ts` (re-exports all)

**Step 1: Create `src/db/emails.ts`**

```typescript
import type { Email } from '../types'

// D1 rows have keywords/labels_applied as JSON strings — parse them
function parseEmail(row: Record<string, unknown>): Email {
  return {
    ...(row as Email),
    keywords: JSON.parse((row.keywords as string) || '[]'),
    labels_applied: JSON.parse((row.labels_applied as string) || '[]'),
    bypassed_inbox: Boolean(row.bypassed_inbox),
  }
}

export async function createEmail(db: D1Database, email: Omit<Email, 'created_at'>): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT OR IGNORE INTO emails
      (id, user_id, from_address, subject, slug, keywords, summary, labels_applied,
       bypassed_inbox, reasoning, human_feedback, processed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    email.id, email.user_id, email.from_address, email.subject, email.slug,
    JSON.stringify(email.keywords), email.summary, JSON.stringify(email.labels_applied),
    email.bypassed_inbox ? 1 : 0, email.reasoning, email.human_feedback,
    email.processed_at, now
  ).run()
}

export async function emailExists(db: D1Database, emailId: string): Promise<boolean> {
  const result = await db.prepare('SELECT 1 FROM emails WHERE id = ?').bind(emailId).first()
  return result !== null
}

export async function getRecentEmails(db: D1Database, userId: number, limit = 50): Promise<Email[]> {
  const result = await db.prepare(`
    SELECT * FROM emails WHERE user_id = ? ORDER BY processed_at DESC LIMIT ?
  `).bind(userId, limit).all()
  return result.results.map(parseEmail)
}

export async function getEmailsByDateRange(
  db: D1Database, userId: number, start: string, end: string
): Promise<Email[]> {
  const result = await db.prepare(`
    SELECT * FROM emails WHERE user_id = ? AND processed_at >= ? AND processed_at < ?
    ORDER BY processed_at ASC
  `).bind(userId, start, end).all()
  return result.results.map(parseEmail)
}

export async function getPastSlugsFromSender(
  db: D1Database, userId: number, fromAddress: string, limit = 5
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT DISTINCT slug FROM emails WHERE user_id = ? AND from_address = ?
    ORDER BY processed_at DESC LIMIT ?
  `).bind(userId, fromAddress, limit).all<{ slug: string }>()
  return result.results.map(r => r.slug)
}

export async function updateEmailFeedback(
  db: D1Database, userId: number, emailId: string, feedback: string
): Promise<void> {
  await db.prepare(`
    UPDATE emails SET human_feedback = ? WHERE id = ? AND user_id = ?
  `).bind(feedback, emailId, userId).run()
}
```

**Step 2: Create `src/db/labels.ts`**

```typescript
import type { Label } from '../types'

function parseLabel(row: Record<string, unknown>): Label {
  return {
    ...(row as Label),
    reasons: JSON.parse((row.reasons as string) || '[]'),
  }
}

export async function getAllLabels(db: D1Database, userId: number): Promise<Label[]> {
  const result = await db.prepare(
    'SELECT * FROM labels WHERE user_id = ? ORDER BY name ASC'
  ).bind(userId).all()
  return result.results.map(parseLabel)
}

export async function createLabel(db: D1Database, userId: number, name: string, description = ''): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO labels (user_id, name, description, reasons, created_at, updated_at)
    VALUES (?, ?, ?, '[]', ?, ?)
  `).bind(userId, name, description, now, now).run()
}

export async function deleteLabel(db: D1Database, userId: number, labelId: number): Promise<void> {
  await db.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?').bind(labelId, userId).run()
}
```

**Step 3: Create `src/db/prompts.ts`**

```typescript
import type { SystemPrompt, PromptType } from '../types'

const DEFAULT_PROMPTS: Record<PromptType, { content: string; description: string }> = {
  email_analyze: {
    description: 'Stage 1: Analyze email content to generate slug, keywords, and summary',
    content: `You are an email classification assistant. Analyze the email and provide a JSON response with:
1. A snake_case_slug that categorizes this type of email (e.g., "marketing_newsletter", "invoice_due", "meeting_request")
2. An array of 3-5 keywords that describe the email content
3. A single line summary (max 100 chars)

Respond ONLY with valid JSON in this format:
{"slug": "example_slug", "keywords": ["word1", "word2", "word3"], "summary": "Brief summary here"}`,
  },
  email_actions: {
    description: 'Stage 2: Determine labels and inbox bypass based on analysis',
    content: `You are an email automation assistant. Based on the email analysis and past learnings, determine what actions to take and respond with JSON.

Available labels:
%s

Decide:
1. Which labels to apply (use exact label names from the list above, only when they clearly match)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decisions

Use the learnings from past email processing (provided below) to make better decisions about labeling and archiving.`,
  },
  daily_review: {
    description: 'Daily memory generation at 5PM',
    content: `You are an AI assistant creating learnings to improve future email processing decisions. Your goal is NOT to summarize what happened, but to extract insights that will help process emails better tomorrow.

Analyze the emails and their categorizations, then create a memory focused on actionable rules and patterns.

IMPORTANT: Keep your response CONCISE - aim for around 100 words maximum. Be specific and actionable. Format as concise bullet points.`,
  },
  weekly_summary: { description: 'Weekly memory consolidation', content: '' },
  monthly_summary: { description: 'Monthly memory consolidation', content: '' },
  yearly_summary: { description: 'Yearly memory consolidation', content: '' },
  wrapup_report: { description: '8AM and 5PM wrap-up reports', content: '' },
}

export async function getSystemPrompt(
  db: D1Database, userId: number, type: PromptType
): Promise<SystemPrompt | null> {
  return db.prepare(`
    SELECT * FROM system_prompts WHERE user_id = ? AND type = ? AND is_active = 1
  `).bind(userId, type).first<SystemPrompt>()
}

export async function getAllSystemPrompts(db: D1Database, userId: number): Promise<SystemPrompt[]> {
  const result = await db.prepare(
    'SELECT * FROM system_prompts WHERE user_id = ? ORDER BY type'
  ).bind(userId).all<SystemPrompt>()
  return result.results
}

export async function upsertSystemPrompt(
  db: D1Database, userId: number, type: PromptType, content: string
): Promise<void> {
  const now = new Date().toISOString()
  // Deactivate any existing prompt of this type
  await db.prepare('UPDATE system_prompts SET is_active = 0 WHERE user_id = ? AND type = ?')
    .bind(userId, type).run()
  // Insert new active prompt
  await db.prepare(`
    INSERT INTO system_prompts (user_id, type, content, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(userId, type, content, now, now).run()
}

export async function initDefaultPrompts(db: D1Database, userId: number): Promise<void> {
  for (const [type, def] of Object.entries(DEFAULT_PROMPTS)) {
    const existing = await getSystemPrompt(db, userId, type as PromptType)
    if (!existing && def.content) {
      await upsertSystemPrompt(db, userId, type as PromptType, def.content)
    }
  }
}
```

**Step 4: Create `src/db/memories.ts`**

```typescript
import type { Memory, MemoryType } from '../types'

export async function createMemory(db: D1Database, memory: Omit<Memory, 'id' | 'created_at'>): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO memories (user_id, type, content, start_date, end_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(memory.user_id, memory.type, memory.content, memory.start_date, memory.end_date, now).run()
}

export async function getMemoriesByType(
  db: D1Database, userId: number, type: MemoryType, limit = 1
): Promise<Memory[]> {
  const result = await db.prepare(`
    SELECT * FROM memories WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, type, limit).all<Memory>()
  return result.results
}

export async function getMemoriesByDateRange(
  db: D1Database, userId: number, type: MemoryType, start: string, end: string
): Promise<Memory[]> {
  const result = await db.prepare(`
    SELECT * FROM memories WHERE user_id = ? AND type = ? AND start_date >= ? AND end_date <= ?
    ORDER BY created_at ASC
  `).bind(userId, type, start, end).all<Memory>()
  return result.results
}

export async function getRecentMemoriesForContext(db: D1Database, userId: number): Promise<Memory[]> {
  // Get 1 yearly, 1 monthly, 1 weekly, and up to 7 daily memories
  const results: Memory[] = []
  for (const [type, limit] of [['yearly', 1], ['monthly', 1], ['weekly', 1], ['daily', 7]] as const) {
    const memories = await getMemoriesByType(db, userId, type, limit)
    results.push(...memories)
  }
  return results
}

export async function getAllMemories(db: D1Database, userId: number, limit = 100): Promise<Memory[]> {
  const result = await db.prepare(`
    SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all<Memory>()
  return result.results
}
```

**Step 5: Create `src/db/wrapups.ts`**

```typescript
import type { WrapupReport } from '../types'

export async function createWrapupReport(
  db: D1Database, report: Omit<WrapupReport, 'id' | 'created_at'>
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO wrapup_reports (user_id, report_type, email_count, content, generated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(report.user_id, report.report_type, report.email_count, report.content, report.generated_at, now).run()
}

export async function getWrapupReports(db: D1Database, userId: number, limit = 30): Promise<WrapupReport[]> {
  const result = await db.prepare(`
    SELECT * FROM wrapup_reports WHERE user_id = ? ORDER BY generated_at DESC LIMIT ?
  `).bind(userId, limit).all<WrapupReport>()
  return result.results
}
```

**Step 6: Create `src/db/index.ts`**

```typescript
export * from './users'
export * from './emails'
export * from './labels'
export * from './prompts'
export * from './memories'
export * from './wrapups'
```

**Step 7: Commit**

```bash
git add src/db/
git commit -m "feat: add D1 DB layer for all entities"
```

---

## Task 6: OpenAI Client

**Files:**
- Create: `src/openai/client.ts`
- Create: `test/openai/client.test.ts`

**Step 1: Write failing test**

```typescript
// test/openai/client.test.ts
import { describe, it, expect } from 'vitest'
import { buildAnalyzePrompts, buildActionsPrompts } from '../../src/openai/client'

describe('openai prompt builders', () => {
  it('builds analyze prompt with past slugs', () => {
    const { userPrompt } = buildAnalyzePrompts(
      'sender@example.com', 'Your Invoice', 'Please pay...', ['invoice_due'], ''
    )
    expect(userPrompt).toContain('invoice_due')
    expect(userPrompt).toContain('sender@example.com')
  })

  it('injects formatted labels into actions system prompt', () => {
    const { systemPrompt } = buildActionsPrompts(
      'sender@example.com', 'Subject', 'invoice_due', [], 'A summary',
      ['Invoices'], '- "Invoices": for billing', '', ''
    )
    expect(systemPrompt).toContain('Invoices')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/openai/client.test.ts
```

Expected: FAIL (module not found)

**Step 3: Create `src/openai/client.ts`**

```typescript
import OpenAI from 'openai'
import type { EmailAnalysis, EmailActions } from '../types'

export function buildAnalyzePrompts(
  from: string, subject: string, body: string, pastSlugs: string[], customPrompt: string
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = customPrompt || `You are an email classification assistant. Analyze the email and provide a JSON response with:
1. A snake_case_slug that categorizes this type of email (e.g., "marketing_newsletter", "invoice_due", "meeting_request")
2. An array of 3-5 keywords that describe the email content
3. A single line summary (max 100 chars)

Respond ONLY with valid JSON in this format:
{"slug": "example_slug", "keywords": ["word1", "word2", "word3"], "summary": "Brief summary here"}`

  const userPrompt = `From: ${from}
Subject: ${subject}

Body:
${body}

Past slugs used from this sender: ${JSON.stringify(pastSlugs)}

Analyze this email and provide the slug, keywords, and summary.`

  return { systemPrompt, userPrompt }
}

export function buildActionsPrompts(
  from: string, subject: string, slug: string, keywords: string[], summary: string,
  _labelNames: string[], formattedLabels: string, memoryContext: string, customPrompt: string
): { systemPrompt: string; userPrompt: string } {
  let systemPrompt = customPrompt || `You are an email automation assistant. Based on the email analysis and past learnings, determine what actions to take and respond with JSON.

Available labels:
%s

Decide:
1. Which labels to apply (use exact label names from the list above, only when they clearly match)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decisions

Use the learnings from past email processing (provided below) to make better decisions about labeling and archiving.`

  if (!customPrompt) {
    systemPrompt = systemPrompt.replace('%s', formattedLabels)
  } else {
    systemPrompt += '\n\nAvailable labels:\n' + formattedLabels
  }

  const userPrompt = `From: ${from}
Subject: ${subject}
Slug: ${slug}
Keywords: ${JSON.stringify(keywords)}
Summary: ${summary}

${memoryContext}What actions should be taken for this email?`

  return { systemPrompt, userPrompt }
}

export async function analyzeEmail(
  apiKey: string, model: string,
  from: string, subject: string, body: string, pastSlugs: string[], customPrompt: string
): Promise<EmailAnalysis> {
  const client = new OpenAI({ apiKey })
  const { systemPrompt, userPrompt } = buildAnalyzePrompts(from, subject, body, pastSlugs, customPrompt)

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'email_analysis',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['slug', 'keywords', 'summary'],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 10000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return JSON.parse(content) as EmailAnalysis
}

export async function determineActions(
  apiKey: string, model: string,
  from: string, subject: string, slug: string, keywords: string[], summary: string,
  labelNames: string[], formattedLabels: string, memoryContext: string, customPrompt: string
): Promise<EmailActions> {
  const client = new OpenAI({ apiKey })
  const { systemPrompt, userPrompt } = buildActionsPrompts(
    from, subject, slug, keywords, summary, labelNames, formattedLabels, memoryContext, customPrompt
  )

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'email_actions',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            labels: { type: 'array', items: { type: 'string' } },
            bypass_inbox: { type: 'boolean' },
            reasoning: { type: 'string' },
          },
          required: ['labels', 'bypass_inbox', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 10000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return JSON.parse(content) as EmailActions
}

export async function generateMemory(
  apiKey: string, model: string, systemPrompt: string, userPrompt: string
): Promise<string> {
  const client = new OpenAI({ apiKey })
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 20000,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return content
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/openai/client.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/openai/ test/openai/
git commit -m "feat: add OpenAI client with prompt builders"
```

---

## Task 7: Gmail Client

**Files:**
- Create: `src/gmail/client.ts`
- Create: `src/gmail/push.ts`

**Step 1: Create `src/gmail/client.ts`**

Direct REST API calls to Google — no npm package needed.

```typescript
import type { GmailMessage, ParsedMessage } from '../types'

export class GmailClient {
  private accessToken: string

  constructor(accessToken: string) {
    this.accessToken = accessToken
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gmail API ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
  }

  async getMessage(messageId: string): Promise<ParsedMessage> {
    const msg = await this.request<GmailMessage>(`messages/${messageId}?format=full`)
    return parseMessage(msg)
  }

  async getUnreadMessages(maxResults = 50): Promise<ParsedMessage[]> {
    const list = await this.request<{ messages?: { id: string }[] }>(
      `messages?q=is:unread+in:inbox&maxResults=${maxResults}`
    )
    if (!list.messages?.length) return []
    return Promise.all(list.messages.map(m => this.getMessage(m.id)))
  }

  async addLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.request(`messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds: labelIds }),
    })
  }

  async archiveMessage(messageId: string): Promise<void> {
    await this.request(`messages/${messageId}/modify`, {
      method: 'POST',
      body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
    })
  }

  async listLabels(): Promise<{ id: string; name: string }[]> {
    const res = await this.request<{ labels: { id: string; name: string }[] }>('labels')
    return res.labels
  }

  async getLabelId(name: string): Promise<string | null> {
    const labels = await this.listLabels()
    return labels.find(l => l.name === name)?.id ?? null
  }

  async createLabel(name: string): Promise<{ id: string; name: string }> {
    return this.request<{ id: string; name: string }>('labels', {
      method: 'POST',
      body: JSON.stringify({
        name,
        messageListVisibility: 'show',
        labelListVisibility: 'labelShow',
        type: 'user',
      }),
    })
  }

  async getOrCreateLabelId(name: string): Promise<string> {
    const id = await this.getLabelId(name)
    if (id) return id
    const label = await this.createLabel(name)
    return label.id
  }

  async watchInbox(topicName: string): Promise<{ historyId: string; expiration: string }> {
    return this.request<{ historyId: string; expiration: string }>('watch', {
      method: 'POST',
      body: JSON.stringify({
        topicName,
        labelIds: ['INBOX'],
        labelFilterAction: 'include',
      }),
    })
  }

  async getMessagesSince(historyId: string): Promise<ParsedMessage[]> {
    try {
      const res = await this.request<{
        history?: { messagesAdded?: { message: { id: string } }[] }[]
        historyId?: string
      }>(`history?startHistoryId=${historyId}&historyTypes=messageAdded&labelId=INBOX`)

      const messageIds = new Set<string>()
      for (const h of res.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          messageIds.add(m.message.id)
        }
      }

      if (!messageIds.size) return []
      return Promise.all([...messageIds].map(id => this.getMessage(id)))
    } catch (e) {
      // historyId might be too old — return empty and let caller handle
      return []
    }
  }
}

function parseMessage(msg: GmailMessage): ParsedMessage {
  let subject = ''
  let from = ''
  for (const h of msg.payload.headers) {
    if (h.name === 'Subject') subject = h.value
    if (h.name === 'From') from = h.value
  }
  return {
    id: msg.id,
    threadId: msg.threadId,
    subject,
    from,
    body: extractBody(msg.payload),
    labelIds: msg.labelIds,
    internalDate: parseInt(msg.internalDate, 10),
  }
}

function extractBody(payload: GmailMessage['payload']): string {
  if (payload.mimeType === 'text/plain' && payload.body.data) {
    return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'))
  }
  for (const part of payload.parts ?? []) {
    const body = extractBody(part)
    if (body) return body
  }
  return ''
}
```

**Step 2: Create `src/gmail/push.ts`**

Handles the Pub/Sub push notification format.

```typescript
// A Pub/Sub push message looks like:
// { message: { data: base64(JSON { emailAddress, historyId }), messageId, publishTime }, subscription }

export interface PubSubMessage {
  message: {
    data: string  // base64-encoded JSON
    messageId: string
    publishTime: string
  }
  subscription: string
}

export interface GmailPushNotification {
  emailAddress: string
  historyId: number
}

export function parsePubSubMessage(body: PubSubMessage): GmailPushNotification {
  const decoded = atob(body.message.data)
  return JSON.parse(decoded) as GmailPushNotification
}
```

**Step 3: Commit**

```bash
git add src/gmail/
git commit -m "feat: add Gmail REST API client and push notification parser"
```

---

## Task 8: Session Helpers

**Files:**
- Create: `src/auth/session.ts`
- Create: `test/auth/session.test.ts`

**Step 1: Write failing test**

```typescript
// test/auth/session.test.ts
import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { createSession, getSession, deleteSession } from '../../src/auth/session'

describe('session', () => {
  it('creates and retrieves a session', async () => {
    const token = await createSession(env.SESSIONS, { userId: 42, email: 'me@example.com' })
    expect(token).toHaveLength(36) // UUID format
    const session = await getSession(env.SESSIONS, token)
    expect(session?.userId).toBe(42)
  })

  it('returns null for unknown token', async () => {
    const session = await getSession(env.SESSIONS, 'not-a-real-token')
    expect(session).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/auth/session.test.ts
```

Expected: FAIL

**Step 3: Create `src/auth/session.ts`**

```typescript
import type { SessionData } from '../types'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export async function createSession(kv: KVNamespace, data: SessionData): Promise<string> {
  const token = generateToken()
  await kv.put(`session:${token}`, JSON.stringify(data), { expirationTtl: SESSION_TTL_SECONDS })
  return token
}

export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null> {
  const raw = await kv.get(`session:${token}`)
  if (!raw) return null
  return JSON.parse(raw) as SessionData
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(`session:${token}`)
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/auth/session.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/auth/ test/auth/
git commit -m "feat: add KV-backed session management"
```

---

## Task 9: OAuth Google Helpers

**Files:**
- Create: `src/auth/google.ts`

```typescript
// src/auth/google.ts

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
}

export interface GoogleUserInfo {
  id: string
  email: string
  name: string
}

export function buildAuthUrl(clientId: string, redirectUrl: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: 'state',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(
  code: string, clientId: string, clientSecret: string, redirectUrl: string
): Promise<GoogleTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUrl, grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`)
  return res.json() as Promise<GoogleTokens>
}

export async function refreshAccessToken(
  refreshToken: string, clientId: string, clientSecret: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: clientId,
      client_secret: clientSecret, grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`)
  return res.json() as Promise<{ access_token: string; expires_in: number }>
}

export async function getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`User info failed: ${await res.text()}`)
  return res.json() as Promise<GoogleUserInfo>
}
```

**Commit:**

```bash
git add src/auth/google.ts
git commit -m "feat: add Google OAuth helpers"
```

---

## Task 10: HTML Templates

**Files:**
- Create: `src/templates/layout.ts`
- Create: `src/templates/home.ts`
- Create: `src/templates/dashboard.ts`
- Create: `src/templates/labels.ts`
- Create: `src/templates/history.ts`
- Create: `src/templates/prompts.ts`
- Create: `src/templates/memories.ts`
- Create: `src/templates/wrapups.ts`

**Step 1: Create `src/templates/layout.ts`**

```typescript
export function layout(title: string, content: string, nav?: { email: string }): string {
  const navHtml = nav ? `
    <nav>
      <ul>
        <li><a href="/dashboard"><strong>Gmail Triage</strong></a></li>
      </ul>
      <ul>
        <li><a href="/labels">Labels</a></li>
        <li><a href="/history">History</a></li>
        <li><a href="/prompts">Prompts</a></li>
        <li><a href="/memories">Memories</a></li>
        <li><a href="/wrapups">Reports</a></li>
        <li><small>${nav.email}</small></li>
        <li><a href="/auth/logout" role="button" class="secondary">Logout</a></li>
      </ul>
    </nav>` : ''

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Gmail Triage</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
  <header class="container">${navHtml}</header>
  <main class="container">${content}</main>
</body>
</html>`
}
```

**Step 2: Create remaining templates**

Each template is a function returning an HTML string. Port each Go template to TypeScript. Example pattern:

```typescript
// src/templates/home.ts
import { layout } from './layout'

export function homePage(): string {
  return layout('Home', `
    <section>
      <h1>Gmail Triage Assistant</h1>
      <p>AI-powered email management that automatically categorizes and labels your Gmail.</p>
      <a href="/auth/login" role="button">Connect Gmail</a>
    </section>
  `)
}
```

Port `dashboard.html`, `labels.html`, `history.html`, `prompts.html`, `memories.html`, `wrapups.html` from `internal/web/templates/` in the original project, adapting Go template syntax to TypeScript template literals.

**Commit:**

```bash
git add src/templates/
git commit -m "feat: add HTML templates as TypeScript template literals"
```

---

## Task 11: Email Processing Pipeline

**Files:**
- Create: `src/pipeline/processor.ts`
- Create: `test/pipeline/processor.test.ts`

**Step 1: Write failing test**

```typescript
// test/pipeline/processor.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildMemoryContext } from '../../src/pipeline/processor'
import type { Memory } from '../../src/types'

describe('pipeline', () => {
  it('builds empty memory context when no memories', () => {
    const ctx = buildMemoryContext([])
    expect(ctx).toBe('')
  })

  it('builds memory context string from memories', () => {
    const memories: Memory[] = [{
      id: 1, user_id: 1, type: 'daily', content: 'some insight',
      start_date: '2025-01-01', end_date: '2025-01-02', created_at: '2025-01-02'
    }]
    const ctx = buildMemoryContext(memories)
    expect(ctx).toContain('DAILY')
    expect(ctx).toContain('some insight')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run test/pipeline/processor.test.ts
```

Expected: FAIL

**Step 3: Create `src/pipeline/processor.ts`**

```typescript
import { GmailClient } from '../gmail/client'
import { analyzeEmail, determineActions } from '../openai/client'
import * as db from '../db'
import type { Env } from '../index'
import type { User, Memory } from '../types'

export function buildMemoryContext(memories: Memory[]): string {
  if (!memories.length) return ''
  let ctx = 'Past learnings from email processing:\n\n'
  for (const mem of memories) {
    ctx += `**${mem.type.toUpperCase()} Memory:**\n${mem.content}\n\n`
  }
  return ctx
}

function truncateBody(body: string, maxLen = 2000): string {
  return body.length > maxLen ? body.slice(0, maxLen) + '...' : body
}

export async function processEmail(
  env: Env,
  user: User,
  messageId: string,
): Promise<void> {
  // Skip if already processed
  if (await db.emailExists(env.DB, messageId)) {
    console.log(`[${user.email}] Email ${messageId} already processed, skipping`)
    return
  }

  const client = new GmailClient(user.access_token)
  const message = await client.getMessage(messageId)

  console.log(`[${user.email}] Processing: ${message.from} - ${message.subject}`)

  const body = truncateBody(message.body)

  // Get system prompts
  const analyzePromptRow = await db.getSystemPrompt(env.DB, user.id, 'email_analyze')
  const actionsPromptRow = await db.getSystemPrompt(env.DB, user.id, 'email_actions')

  // Get memory context
  const memories = await db.getRecentMemoriesForContext(env.DB, user.id)
  const memoryContext = buildMemoryContext(memories)

  // Stage 1: Analyze
  const pastSlugs = await db.getPastSlugsFromSender(env.DB, user.id, message.from, 5)
  const analysis = await analyzeEmail(
    env.OPENAI_API_KEY, env.OPENAI_MODEL,
    message.from, message.subject, body, pastSlugs, analyzePromptRow?.content ?? ''
  )

  console.log(`[${user.email}] Stage 1 - Slug: ${analysis.slug}`)

  // Stage 2: Determine actions
  const labels = await db.getAllLabels(env.DB, user.id)
  const labelNames = labels.map(l => l.name)
  const formattedLabels = labels.map(l => {
    let line = `- "${l.name}"`
    if (l.description) line += `: ${l.description}`
    if (l.reasons.length) line += ` (e.g. ${l.reasons.join(', ')})`
    return line
  }).join('\n')

  const actions = await determineActions(
    env.OPENAI_API_KEY, env.OPENAI_MODEL,
    message.from, message.subject, analysis.slug, analysis.keywords, analysis.summary,
    labelNames, formattedLabels, memoryContext, actionsPromptRow?.content ?? ''
  )

  console.log(`[${user.email}] Stage 2 - Labels: ${actions.labels}, Bypass: ${actions.bypass_inbox}`)

  // Save to DB
  await db.createEmail(env.DB, {
    id: message.id,
    user_id: user.id,
    from_address: message.from,
    subject: message.subject,
    slug: analysis.slug,
    keywords: analysis.keywords,
    summary: analysis.summary,
    labels_applied: actions.labels,
    bypassed_inbox: actions.bypass_inbox,
    reasoning: actions.reasoning,
    human_feedback: '',
    processed_at: new Date().toISOString(),
  })

  // Apply to Gmail
  await applyToGmail(client, message.id, actions.labels, actions.bypass_inbox)

  console.log(`[${user.email}] ✓ Processed: ${message.subject}`)
}

async function applyToGmail(
  client: GmailClient, messageId: string, labelNames: string[], bypassInbox: boolean
): Promise<void> {
  if (labelNames.length > 0) {
    const labelIds = await Promise.all(labelNames.map(name => client.getOrCreateLabelId(name)))
    await client.addLabels(messageId, labelIds.filter(Boolean) as string[])
  }
  if (bypassInbox) {
    await client.archiveMessage(messageId)
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run test/pipeline/processor.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/pipeline/ test/pipeline/
git commit -m "feat: add email processing pipeline"
```

---

## Task 12: Memory and Wrapup Services

**Files:**
- Create: `src/memory/service.ts`
- Create: `src/wrapup/service.ts`

Port the logic directly from `internal/memory/service.go` and `internal/wrapup/service.go`. The structure is identical — just TypeScript instead of Go. Use `generateMemory()` from the OpenAI client.

**`src/memory/service.ts`** — port `GenerateDailyMemory`, `GenerateWeeklyMemory`, `GenerateMonthlyMemory`, `GenerateYearlyMemory`, `consolidateMemories` and `generateMemoryFromEmails`. Use the same prompt text from the Go code.

**`src/wrapup/service.ts`** — port `GenerateMorningWrapup`, `GenerateEveningWrapup`, `generateWrapupContent`. Same window logic: morning = since 5PM yesterday, evening = since 8AM today.

Both services call `db.*` functions and `generateMemory()` — they take `env: Env` instead of constructor dependencies.

**Commit:**

```bash
git add src/memory/ src/wrapup/
git commit -m "feat: add memory consolidation and wrapup report services"
```

---

## Task 13: Auth Routes

**Files:**
- Modify: `src/index.ts`
- Create: `src/routes/auth.ts`

**Step 1: Create `src/routes/auth.ts`**

```typescript
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../index'
import { buildAuthUrl, exchangeCode, getUserInfo } from '../auth/google'
import { createSession, deleteSession } from '../auth/session'
import * as db from '../db'
import { homePage } from '../templates/home'

export const authRoutes = new Hono<{ Bindings: Env }>()

authRoutes.get('/login', (c) => {
  const url = buildAuthUrl(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_REDIRECT_URL)
  return c.redirect(url, 302)
})

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('No code', 400)

  const tokens = await exchangeCode(
    code, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.GOOGLE_REDIRECT_URL
  )
  const userInfo = await getUserInfo(tokens.access_token)
  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  let user = await db.getUserByGoogleId(c.env.DB, userInfo.id)
  if (!user) {
    user = await db.createUser(c.env.DB, {
      email: userInfo.email,
      google_id: userInfo.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? '',
      token_expiry: tokenExpiry,
    })
  } else {
    await db.updateUserToken(c.env.DB, user.id, tokens.access_token, tokens.refresh_token ?? user.refresh_token, tokenExpiry)
    user = (await db.getUser(c.env.DB, user.id))!
  }

  // Register Gmail watch for push notifications
  try {
    const { GmailClient } = await import('../gmail/client')
    const gmailClient = new GmailClient(tokens.access_token)
    const watch = await gmailClient.watchInbox(c.env.PUBSUB_TOPIC)
    await db.updateGmailHistoryId(c.env.DB, user.id, watch.historyId)
  } catch (e) {
    console.error('Failed to register Gmail watch:', e)
  }

  const token = await createSession(c.env.SESSIONS, { userId: user.id, email: user.email })
  setCookie(c, 'session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return c.redirect('/dashboard', 302)
})

authRoutes.get('/logout', async (c) => {
  const token = getCookie(c, 'session')
  if (token) await deleteSession(c.env.SESSIONS, token)
  deleteCookie(c, 'session')
  return c.redirect('/', 302)
})
```

**Step 2: Update `src/index.ts` to mount auth routes**

```typescript
import { authRoutes } from './routes/auth'

app.get('/', async (c) => {
  const token = getCookie(c, 'session')
  if (token) {
    const session = await getSession(c.env.SESSIONS, token)
    if (session) return c.redirect('/dashboard', 302)
  }
  return c.html(homePage())
})

app.route('/auth', authRoutes)
```

**Step 3: Commit**

```bash
git add src/routes/auth.ts src/index.ts
git commit -m "feat: add Google OAuth auth routes"
```

---

## Task 14: Auth Middleware + Protected Routes

**Files:**
- Create: `src/middleware/auth.ts`
- Create: `src/routes/dashboard.ts`
- Create: `src/routes/labels.ts`
- Create: `src/routes/history.ts`
- Create: `src/routes/prompts.ts`
- Create: `src/routes/memories.ts`
- Create: `src/routes/wrapups.ts`

**Step 1: Create `src/middleware/auth.ts`**

```typescript
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { Env } from '../index'
import { getSession } from '../auth/session'
import { getUser } from '../db'
import type { User } from '../types'

type AuthVariables = { user: User }

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const token = getCookie(c, 'session')
    if (!token) return c.redirect('/auth/login', 302)

    const session = await getSession(c.env.SESSIONS, token)
    if (!session) return c.redirect('/auth/login', 302)

    const user = await getUser(c.env.DB, session.userId)
    if (!user) return c.redirect('/auth/login', 302)

    c.set('user', user)
    await next()
  }
)
```

**Step 2: Create each route file**

For each of `dashboard.ts`, `labels.ts`, `history.ts`, `prompts.ts`, `memories.ts`, `wrapups.ts`:

1. Create a `new Hono<{ Bindings: Env; Variables: { user: User } }>()` router
2. Apply `requireAuth` middleware
3. Port the corresponding handler from `internal/web/server.go`
4. Render using the template function from `src/templates/`

Example `src/routes/labels.ts`:

```typescript
import { Hono } from 'hono'
import type { Env } from '../index'
import type { User } from '../types'
import { requireAuth } from '../middleware/auth'
import * as db from '../db'
import { labelsPage } from '../templates/labels'

export const labelsRoutes = new Hono<{ Bindings: Env; Variables: { user: User } }>()

labelsRoutes.use('*', requireAuth)

labelsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const labels = await db.getAllLabels(c.env.DB, user.id)
  return c.html(labelsPage(user.email, labels))
})

labelsRoutes.post('/create', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const name = String(body.name ?? '').trim()
  const description = String(body.description ?? '').trim()
  if (!name) return c.text('Name required', 400)
  await db.createLabel(c.env.DB, user.id, name, description)
  return c.redirect('/labels', 302)
})

labelsRoutes.post('/:id/delete', async (c) => {
  const user = c.get('user')
  const id = parseInt(c.req.param('id'), 10)
  await db.deleteLabel(c.env.DB, user.id, id)
  return c.redirect('/labels', 302)
})
```

**Step 3: Mount all routes in `src/index.ts`**

```typescript
app.route('/dashboard', dashboardRoutes)
app.route('/labels', labelsRoutes)
app.route('/history', historyRoutes)
app.route('/prompts', promptsRoutes)
app.route('/memories', memoriesRoutes)
app.route('/wrapups', wrapupsRoutes)
```

**Step 4: Commit**

```bash
git add src/middleware/ src/routes/
git commit -m "feat: add auth middleware and all protected routes"
```

---

## Task 15: Gmail Push Webhook + Queue Consumer

**Files:**
- Create: `src/routes/gmail-push.ts`
- Create: `src/queue/consumer.ts`

**Step 1: Create `src/routes/gmail-push.ts`**

The push webhook does the minimum: parse the notification, look up which messages are new via the History API, enqueue each `{userId, messageId}`, return 200. No AI calls, no heavy work.

```typescript
import { Hono } from 'hono'
import type { Env } from '../index'
import { parsePubSubMessage } from '../gmail/push'
import { GmailClient } from '../gmail/client'
import { getActiveUsers, updateGmailHistoryId } from '../db'

export const gmailPushRoutes = new Hono<{ Bindings: Env }>()

gmailPushRoutes.post('/push', async (c) => {
  // Verify this is from our Pub/Sub subscription
  const token = c.req.query('token')
  if (token !== c.env.PUBSUB_VERIFICATION_TOKEN) {
    return c.text('Unauthorized', 401)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.text('Invalid JSON', 400)
  }

  try {
    const notification = parsePubSubMessage(body as Parameters<typeof parsePubSubMessage>[0])
    const users = await getActiveUsers(c.env.DB)
    const user = users.find(u => u.email === notification.emailAddress)
    if (!user) return c.text('OK', 200) // unknown user — acknowledge and move on

    // Use Gmail History API to get message IDs added since last check
    const client = new GmailClient(user.access_token)
    const messages = await client.getMessagesSince(user.gmail_history_id ?? '0')

    // Update stored history ID immediately
    await updateGmailHistoryId(c.env.DB, user.id, String(notification.historyId))

    // Enqueue each new message for background processing — do NOT process here
    if (messages.length > 0) {
      await c.env.EMAIL_QUEUE.sendBatch(
        messages.map(msg => ({ body: { userId: user.id, messageId: msg.id } }))
      )
      console.log(`Enqueued ${messages.length} message(s) for ${user.email}`)
    }
  } catch (e) {
    console.error('Push notification error:', e)
    // Still return 200 — returning non-200 causes Pub/Sub to retry the notification
  }

  return c.text('OK', 200)
})
```

**Step 2: Create `src/queue/consumer.ts`**

The Queue consumer runs in its own invocation with up to 15 minutes. It processes emails and acks/retries each message individually.

```typescript
import type { Env, EmailQueueMessage } from '../index'
import { getUser } from '../db'
import { processEmail } from '../pipeline/processor'

export async function handleEmailQueue(
  batch: MessageBatch<EmailQueueMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { userId, messageId } = message.body
    try {
      const user = await getUser(env.DB, userId)
      if (!user) {
        console.warn(`User ${userId} not found for message ${messageId}, acking`)
        message.ack()
        continue
      }

      await processEmail(env, user, messageId)
      message.ack()
      console.log(`✓ Processed message ${messageId} for user ${user.email}`)
    } catch (e) {
      console.error(`Failed to process message ${messageId}:`, e)
      message.retry() // Cloudflare will retry up to max_retries times
    }
  }
}
```

**Step 3: Wire push route and queue handler into `src/index.ts`**

```typescript
import { gmailPushRoutes } from './routes/gmail-push'
import { handleEmailQueue } from './queue/consumer'
import type { EmailQueueMessage } from './index'

app.route('/api/gmail', gmailPushRoutes)

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env))
  },
  async queue(batch: MessageBatch<EmailQueueMessage>, env: Env) {
    await handleEmailQueue(batch, env)
  },
}
```

**Step 4: Commit**

```bash
git add src/routes/gmail-push.ts src/queue/consumer.ts
git commit -m "feat: add Gmail push webhook (enqueues) and Queue consumer (processes)"
```

---

## Task 16: Cron Trigger Dispatcher

**Files:**
- Create: `src/crons/index.ts`
- Create: `src/crons/morning-wrapup.ts`
- Create: `src/crons/evening.ts`
- Create: `src/crons/weekly-memory.ts`
- Create: `src/crons/monthly-memory.ts`
- Create: `src/crons/yearly-memory.ts`
- Create: `src/crons/renew-watch.ts`

**Step 1: Create cron handlers**

Each cron file exports an async function that takes `env: Env` and runs the job for all active users.

Example `src/crons/morning-wrapup.ts`:

```typescript
import type { Env } from '../index'
import { getActiveUsers } from '../db'
import { generateMorningWrapup } from '../wrapup/service'

export async function runMorningWrapup(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      await generateMorningWrapup(env, user.id)
      console.log(`✓ Morning wrapup for ${user.email}`)
    } catch (e) {
      console.error(`Morning wrapup failed for ${user.email}:`, e)
    }
  }
}
```

Follow the same pattern for `evening.ts` (wrapup + daily memory), `weekly-memory.ts`, `monthly-memory.ts`, `yearly-memory.ts`.

**Step 2: Create `src/crons/renew-watch.ts`**

```typescript
import type { Env } from '../index'
import { getActiveUsers, updateGmailHistoryId } from '../db'
import { GmailClient } from '../gmail/client'

export async function renewGmailWatch(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      const client = new GmailClient(user.access_token)
      const watch = await client.watchInbox(env.PUBSUB_TOPIC)
      await updateGmailHistoryId(env.DB, user.id, watch.historyId)
      console.log(`✓ Gmail watch renewed for ${user.email}`)
    } catch (e) {
      console.error(`Watch renewal failed for ${user.email}:`, e)
    }
  }
}
```

**Step 3: Create `src/crons/index.ts` — dispatch by cron expression**

```typescript
import type { Env } from '../index'
import { runMorningWrapup } from './morning-wrapup'
import { runEveningTasks } from './evening'
import { runWeeklyMemory } from './weekly-memory'
import { runMonthlyMemory } from './monthly-memory'
import { runYearlyMemory } from './yearly-memory'
import { renewGmailWatch } from './renew-watch'

export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const cron = event.cron
  console.log(`Cron triggered: ${cron}`)

  switch (cron) {
    case '0 8 * * *':   return runMorningWrapup(env)
    case '0 17 * * *':  return runEveningTasks(env)
    case '0 18 * * 6':  return runWeeklyMemory(env)
    case '0 19 1 * *':  return runMonthlyMemory(env)
    case '0 20 1 1 *':  return runYearlyMemory(env)
    case '0 9 * * *':   return renewGmailWatch(env)
    default: console.warn(`Unknown cron: ${cron}`)
  }
}
```

**Step 4: Wire into `src/index.ts` default export**

```typescript
import { handleScheduled } from './crons'

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env))
  }
}
```

**Step 5: Commit**

```bash
git add src/crons/
git commit -m "feat: add cron trigger handlers for all scheduled jobs"
```

---

## Task 17: Local Dev Smoke Test

**Step 1: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 2: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass.

**Step 3: Start local dev server**

```bash
npx wrangler dev
```

Open `http://localhost:8787` in browser. Expected: home page renders with "Connect Gmail" button.

**Step 4: Test OAuth flow**

Navigate to `http://localhost:8787/auth/login`. Should redirect to Google OAuth. (Requires `GOOGLE_CLIENT_ID` set in `.dev.vars` file — see next task.)

**Step 5: Create `.dev.vars`**

```bash
# .dev.vars (gitignored)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URL=http://localhost:8787/auth/callback
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini
SESSION_SECRET=replace_with_32_char_random_string
PUBSUB_TOPIC=projects/your_project/topics/gmail-triage
PUBSUB_VERIFICATION_TOKEN=replace_with_random_token
```

Add `.dev.vars` to `.gitignore`.

**Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: add .dev.vars to .gitignore"
```

---

## Task 18: Deploy to Cloudflare

**Step 1: Create D1 database**

```bash
wrangler d1 create gmail-triage
# Copy database_id into wrangler.toml
```

**Step 2: Create KV namespace**

```bash
wrangler kv namespace create SESSIONS
# Copy id into wrangler.toml
```

**Step 3: Create Queue**

```bash
wrangler queues create email-processing
# No ID to copy — wrangler.toml references it by name
```

**Step 4: Run D1 migration against production**

```bash
wrangler d1 execute gmail-triage --file=src/db/schema.sql
```

**Step 5: Set secrets**

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REDIRECT_URL
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_MODEL
wrangler secret put SESSION_SECRET
wrangler secret put PUBSUB_TOPIC
wrangler secret put PUBSUB_VERIFICATION_TOKEN
```

**Step 5: Deploy**

```bash
wrangler deploy
```

Note the deployed URL (e.g. `https://gmail-triage-assistant.your-account.workers.dev`).

**Step 6: Update Google OAuth redirect URL**

In Google Cloud Console → Credentials → Your OAuth client:
- Add `https://gmail-triage-assistant.your-account.workers.dev/auth/callback` to Authorized redirect URIs

**Step 7: Set up Google Cloud Pub/Sub**

```bash
# In Google Cloud Console (or gcloud CLI):
gcloud pubsub topics create gmail-triage
gcloud pubsub subscriptions create gmail-triage-push \
  --topic gmail-triage \
  --push-endpoint="https://gmail-triage-assistant.your-account.workers.dev/api/gmail/push?token=YOUR_VERIFICATION_TOKEN" \
  --push-auth-service-account=your-service-account@your-project.iam.gserviceaccount.com

# Grant Gmail permission to publish to the topic:
gcloud pubsub topics add-iam-policy-binding gmail-triage \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

**Step 8: Verify deployment**

Visit `https://gmail-triage-assistant.your-account.workers.dev`. Should see home page. Connect Gmail → should complete OAuth flow and register Gmail watch.

---

## Summary

This plan rewrites the Gmail Triage Assistant from a persistent Go server to a fully serverless Cloudflare Workers architecture:

- **18 tasks** from project init through deployment
- **No persistent process** — Gmail push enqueues to a Queue, Queue consumer processes async; cron triggers replace the scheduler goroutine
- **Cloudflare Queue** decouples the push webhook (fast, lightweight) from email processing (slow, AI-heavy) with automatic retries
- **D1 (SQLite)** replaces PostgreSQL — minor adaptation for JSON arrays stored as TEXT
- **KV** replaces gorilla/sessions for session management
- **Hono.js** provides familiar Express-like routing, Workers-native
- **TypeScript** throughout, direct Google REST API calls (no googleapis npm)
- All original features preserved: 2-stage AI pipeline, memory consolidation, wrapup reports, HTMX UI
