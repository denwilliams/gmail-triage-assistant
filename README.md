# Gmail Triage Assistant

AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a two-stage AI pipeline with self-improving hierarchical memory.

> **This branch** is a TypeScript rewrite targeting Cloudflare Workers. See the `main` branch for the original Go version.

## Architecture

### Email Processing Flow

Gmail Push Notifications (via Google Cloud Pub/Sub) → Cloudflare Queue → Queue Consumer

The push webhook does minimal work — it enqueues `{userId, messageId}` and returns 200 immediately. The Queue consumer handles the full pipeline with up to 15 minutes and automatic retries.

```
New Email
  └─→ Gmail Pub/Sub → POST /api/gmail/push
        └─→ Enqueue {userId, messageId} → email-processing Queue
              └─→ Queue Consumer
                    ├─→ Stage 1: analyzeEmail() — slug, keywords, summary
                    ├─→ Stage 2: determineActions() — labels, archive?
                    ├─→ Save to D1
                    └─→ Apply labels/archive to Gmail
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers |
| Router | Hono.js |
| Database | Cloudflare D1 (SQLite) |
| Sessions | Cloudflare KV (UUID tokens, 7-day TTL) |
| Async processing | Cloudflare Queues |
| Scheduling | Cloudflare Cron Triggers |
| Gmail monitoring | Gmail Push Notifications via Google Cloud Pub/Sub |
| AI | OpenAI (gpt-4o-mini) |
| UI | HTMX + Pico CSS |

### Hierarchical Memory System

```
Emails Processed Daily
  └─→ 5PM: Daily Memory (yesterday's emails → learnings)
        └─→ 6PM Saturday: Weekly Memory (consolidates 7 daily memories)
              └─→ 7PM 1st of Month: Monthly Memory (consolidates weekly memories)
                    └─→ 8PM January 1st: Yearly Memory (consolidates monthly memories)
```

When processing each email, the AI receives: 1 yearly + 1 monthly + 1 weekly + 7 daily memories as context.

### Cron Schedule

| Cron | Job |
|------|-----|
| `0 8 * * *` | Morning wrapup (emails since 5PM yesterday) |
| `0 17 * * *` | Evening wrapup + daily memory generation |
| `0 18 * * 6` | Weekly memory (Saturday) |
| `0 19 1 * *` | Monthly memory (1st of month) |
| `0 20 1 1 *` | Yearly memory (January 1st) |
| `0 9 * * *` | Renew Gmail watch (expires every 7 days) |

## Project Structure

```
src/
├── index.ts              # Entry point: Hono app, cron dispatcher, queue handler
├── types.ts              # All TypeScript interfaces
├── db/
│   ├── schema.sql        # D1 SQLite schema
│   ├── users.ts
│   ├── emails.ts
│   ├── labels.ts
│   ├── prompts.ts
│   ├── memories.ts
│   ├── wrapups.ts
│   └── index.ts          # barrel re-export
├── auth/
│   ├── session.ts        # KV-backed UUID session tokens
│   └── google.ts         # OAuth helpers (direct fetch, no googleapis package)
├── gmail/
│   ├── client.ts         # Gmail REST API client
│   └── push.ts           # Pub/Sub notification parser
├── openai/
│   └── client.ts         # analyzeEmail, determineActions, generateMemory
├── pipeline/
│   └── processor.ts      # Full email processing orchestrator
├── memory/
│   └── service.ts        # Daily/weekly/monthly/yearly memory generation
├── wrapup/
│   └── service.ts        # Morning/evening digest reports
├── templates/
│   ├── layout.ts         # Shared HTML shell (Pico CSS + HTMX)
│   ├── home.ts
│   ├── dashboard.ts
│   ├── labels.ts
│   ├── history.ts
│   ├── prompts.ts
│   ├── memories.ts
│   ├── wrapups.ts
│   └── index.ts
├── routes/
│   ├── auth.ts           # /auth/login, /auth/callback, /auth/logout
│   ├── dashboard.ts
│   ├── labels.ts
│   ├── history.ts
│   ├── prompts.ts
│   ├── memories.ts
│   ├── wrapups.ts
│   └── gmail-push.ts     # POST /api/gmail/push — enqueues only, no processing
├── middleware/
│   └── auth.ts           # requireAuth middleware
├── queue/
│   └── consumer.ts       # handleEmailQueue — ack/retry per message
└── crons/
    ├── index.ts           # handleScheduled — dispatch by event.cron
    ├── morning-wrapup.ts
    ├── evening.ts
    ├── weekly-memory.ts
    ├── monthly-memory.ts
    ├── yearly-memory.ts
    └── renew-watch.ts
```

## Local Development

### Prerequisites

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Google Cloud project with Gmail API and Pub/Sub enabled
- OpenAI API key

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create local D1 database**

   ```bash
   wrangler d1 create gmail-triage
   # Copy the database_id into wrangler.toml
   wrangler d1 execute gmail-triage --local --file=src/db/schema.sql
   ```

3. **Configure local secrets**

   ```bash
   cp .dev.vars.example .dev.vars
   # Fill in your credentials
   ```

4. **Run locally**

   ```bash
   npx wrangler dev
   # Open http://localhost:8787
   ```

### Environment Variables (`.dev.vars`)

```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URL=http://localhost:8787/auth/callback
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
SESSION_SECRET=replace_with_32_char_random_string
PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-triage
PUBSUB_VERIFICATION_TOKEN=replace_with_random_token
```

### Tests

```bash
npx vitest run
```

### Type check

```bash
npx tsc --noEmit
```

## Deployment

### 1. Create Cloudflare resources

```bash
wrangler d1 create gmail-triage
# Copy database_id into wrangler.toml

wrangler kv namespace create SESSIONS
# Copy id into wrangler.toml

wrangler queues create email-processing
```

### 2. Apply schema

```bash
wrangler d1 execute gmail-triage --file=src/db/schema.sql
```

### 3. Set secrets

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

### 4. Deploy

```bash
wrangler deploy
```

### 5. Set up Google Cloud Pub/Sub

```bash
gcloud pubsub topics create gmail-triage

gcloud pubsub subscriptions create gmail-triage-push \
  --topic gmail-triage \
  --push-endpoint="https://YOUR_WORKER.workers.dev/api/gmail/push?token=YOUR_VERIFICATION_TOKEN"

# Grant Gmail permission to publish
gcloud pubsub topics add-iam-policy-binding gmail-triage \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

### 6. Update Google OAuth redirect URI

In Google Cloud Console → Credentials → your OAuth client, add:
```
https://YOUR_WORKER.workers.dev/auth/callback
```

## Notes

- **Arrays in D1**: SQLite doesn't have array types. `keywords`, `labels_applied`, and `reasons` are stored as JSON strings and parsed in the DB layer.
- **Gmail watch expiry**: Gmail push notifications expire after 7 days. The `0 9 * * *` cron renews them daily.
- **Queue retries**: If email processing fails, the Queue retries up to 3 times (`max_retries = 3` in `wrangler.toml`). The `emailExists()` check prevents duplicate processing.
- **No googleapis package**: All Google API calls use direct `fetch()` to the REST API. This keeps the bundle small and avoids Node.js compatibility issues in Workers.
