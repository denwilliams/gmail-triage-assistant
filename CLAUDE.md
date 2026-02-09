# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gmail Triage Assistant - An AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a multi-stage AI pipeline.

## Technology Stack

- **Language**: Go (for small memory footprint)
- **Web UI**: HTMX (to avoid complex frontend builds)
- **Authentication**: OAuth with Google (requires client ID and secret)
- **AI Provider**: OpenAI nano models (v5 is latest, for cost saving)
- **Database**: PostgreSQL - stores email analysis results, slugs, keywords, and memories with native JSONB support

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

The system implements a hierarchical memory consolidation strategy:

- **8AM & 5PM**: Wrap-up reports of all processed emails since last report
- **5PM Daily**: Review pipeline decisions, create daily memories
- **6PM Saturday**: Consolidate weekly memories
- **7PM 1st of Month**: Consolidate monthly memories
- **8PM 1st of Year**: Consolidate yearly memories

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
