# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail Triage Assistant - An AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a multi-stage AI pipeline.

## Technology Stack

- **Backend**: Go (for small memory footprint)
- **Frontend**: React SPA (Vite + TypeScript + React Router v7 + shadcn/ui + Tailwind CSS)
- **Deployment**: Single binary with embedded SPA via `//go:embed` (`frontend/embed.go`)
- **Authentication**: OAuth with Google (requires client ID and secret)
- **AI Provider**: OpenAI nano models (v5 is latest, for cost saving)
- **Database**: PostgreSQL - stores email analysis results, slugs, keywords, and memories with native JSONB support

### Dev Workflow

```bash
# Terminal 1: Go API server
make run

# Terminal 2: Vite dev server (proxies /api and /auth to :8080)
cd frontend && npm run dev
```

Production: `make build` produces a single binary with the SPA embedded.

## Core Architecture

### Email Processing Pipeline

Each email undergoes a two-stage AI analysis:

1. **Stage 1 - Content Analysis**: Analyzes subject and body to generate:
   - A `snake_case_slug` (or hash) like `marketing_newsletter` or `invoice_due_reminder`
   - Array of keywords
   - Single line summary
   - Uses past slugs from the same email address to encourage reuse

2. **Stage 2 - Action Generation**: Takes slug and categories to determine:
   - Labels to apply
   - Whether to bypass inbox
   - Additional actions (TBD)

3. **Storage**: All analysis results saved to database with email ID as primary key for tracking Gmail actions

### Self-Improvement System

The system implements a hierarchical memory consolidation strategy with automatic scheduling:

**Daily Schedule:**
- **8AM**: Morning wrap-up report (emails processed since 5PM yesterday)
- **5PM**: Evening wrap-up report + daily memory generation (analyzes day's emails)

**Hierarchical Memory Consolidation:**
- **6PM Saturday**: Weekly memory (consolidates past 7 daily memories into higher-level insights)
- **7PM 1st of Month**: Monthly memory (consolidates weekly memories from past month)
- **8PM January 1st**: Yearly memory (consolidates monthly memories from past year)

Each memory level learns from the level below, creating progressively higher-level pattern recognition that informs future email processing decisions. All memories are passed to the AI during email processing to provide historical context.

### Configuration

- System prompts configurable via web UI
- Each Gmail label can have a list of reasons for usage (configured in UI, included in system prompt)

### Future Enhancements

- Weekly journal generation
- Human thumbs up/down feedback for decisions
- Learn from human-applied label changes

## Database Schema Considerations

- Email ID as primary key for analysis results
- Store: slugs, keywords, summaries, applied labels, actions taken
- Memory table for daily/weekly/monthly/yearly consolidations
- Slug history per email address for reuse suggestions
