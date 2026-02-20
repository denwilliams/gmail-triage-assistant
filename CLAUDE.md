# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail Triage Assistant - An AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a multi-stage AI pipeline.

> This branch is a TypeScript rewrite targeting Cloudflare Workers. The original Go implementation is on `main`.

## Technology Stack

- **Runtime**: Cloudflare Workers (TypeScript)
- **Router**: Hono.js
- **Web UI**: HTMX + Pico CSS (no frontend build tools)
- **Authentication**: OAuth with Google (KV-backed UUID session tokens)
- **AI Provider**: OpenAI (gpt-4o-mini, for cost saving)
- **Database**: Cloudflare D1 (SQLite) — JSON arrays stored as TEXT strings
- **Sessions**: Cloudflare KV — `session:{uuid}` → `{userId, email}`, 7-day TTL
- **Async Processing**: Cloudflare Queues — push webhook enqueues, consumer processes
- **Scheduling**: Cloudflare Cron Triggers

## Core Architecture

### Email Processing Pipeline

Gmail Push Notifications (via Google Cloud Pub/Sub) replace the polling goroutine. The push webhook does minimal work — enqueue and return 200. The Queue consumer handles all heavy lifting.

Each email undergoes a two-stage AI analysis:

1. **Stage 1 - Content Analysis** (`src/openai/client.ts` — `analyzeEmail`): Analyzes subject and body to generate:
   - A `snake_case_slug` like `marketing_newsletter` or `invoice_due_reminder`
   - Array of keywords
   - Single line summary
   - Uses past slugs from the same email address to encourage reuse

2. **Stage 2 - Action Generation** (`src/openai/client.ts` — `determineActions`): Takes slug and context to determine:
   - Labels to apply
   - Whether to bypass inbox
   - Reasoning

3. **Storage**: All analysis results saved to D1 with email ID as primary key

### Queue Architecture

The push webhook (`src/routes/gmail-push.ts`) only enqueues `{userId, messageId}` and returns 200 immediately — never processes email inline. The Queue consumer (`src/queue/consumer.ts`) handles `processEmail()` with up to 15 minutes and automatic retries.

### Self-Improvement System

Hierarchical memory consolidation via Cron Triggers:

- **8AM daily**: Morning wrap-up report (emails since 5PM yesterday)
- **5PM daily**: Evening wrap-up + daily memory generation
- **6PM Saturday**: Weekly memory (consolidates 7 daily memories)
- **7PM 1st of month**: Monthly memory (consolidates weekly memories)
- **8PM January 1st**: Yearly memory (consolidates monthly memories)
- **9AM daily**: Renew Gmail watch (expires every 7 days)

### Configuration

- System prompts configurable via web UI (`/prompts`)
- Each Gmail label can have a description and reasons (configured in UI, included in AI prompt)

## Key Implementation Notes

- **D1 arrays**: SQLite has no array type — `keywords`, `labels_applied`, and `reasons` are stored as JSON strings and parsed in the DB layer (`src/db/`)
- **No googleapis package**: All Google API calls use direct `fetch()` — keeps bundle small, avoids Node.js compat issues
- **skipLibCheck**: `tsconfig.json` has `"skipLibCheck": true` to resolve a Hono/Workers-types conflict
- **Vitest version**: Must use vitest 3.x — `@cloudflare/vitest-pool-workers` doesn't support v4+
- **Test setup**: `db.exec()` fails with multi-statement SQL in Workers test env — use individual `db.prepare().run()` calls instead (see `test/setup.ts`)

## Project Structure

```
src/
├── index.ts          # Entry point: app, cron dispatcher, queue handler
├── types.ts          # All interfaces
├── db/               # D1 database layer
├── auth/             # session.ts (KV), google.ts (OAuth)
├── gmail/            # client.ts (REST API), push.ts (Pub/Sub parser)
├── openai/           # client.ts (analyzeEmail, determineActions, generateMemory)
├── pipeline/         # processor.ts (full email processing orchestrator)
├── memory/           # service.ts (daily/weekly/monthly/yearly generation)
├── wrapup/           # service.ts (morning/evening digest reports)
├── templates/        # HTML pages as TypeScript template literal functions
├── routes/           # auth, dashboard, labels, history, prompts, memories, wrapups, gmail-push
├── middleware/       # auth.ts (requireAuth)
├── queue/            # consumer.ts (handleEmailQueue)
└── crons/            # index.ts + one file per scheduled job
```
