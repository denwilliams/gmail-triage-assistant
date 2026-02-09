# Gmail Triage Assistant - Development TODO

Update the README.md after each phase is completed to reflect the current state of the project and provide instructions for setup and usage. Also check off anything in REQUIREMENTS.md that has been completed as part of each phase.

## Phase 1: Project Setup & Foundation ✅
- [x] Initialize Go module and project structure
- [x] Set up basic directory structure (cmd, internal, web, etc.)
- [x] Create Makefile with common commands (build, run, test, lint)
- [x] Set up database (PostgreSQL, create schema)
- [x] Define database models for emails, labels, and memories
- [x] Set up environment variable configuration (.env support)
- [x] Add .gitignore for Go projects

## Phase 2: Gmail OAuth & API Integration ✅
- [x] Implement Google OAuth flow (redesigned for multi-user web application)
- [x] Create Gmail API client wrapper
- [x] Implement email fetching (monitor new emails for multiple users)
- [x] Implement email labeling operations
- [x] Implement inbox bypass functionality
- [x] Build web server with OAuth callback endpoints
- [x] Create users table with refresh token storage
- [x] Update all database models to support multi-user (user_id foreign keys)
- [x] Implement multi-user monitor that polls Gmail for all active users
- [x] Add automatic token refresh when tokens expire
- [x] Test Gmail API integration with real mailbox (requires actual Gmail account setup)

## Phase 3: OpenAI Integration ✅
- [x] Create OpenAI client wrapper (nano v5 models)
- [x] Implement Stage 1 AI: Content analysis (slug, keywords, summary)
- [x] Implement Stage 2 AI: Action generation (labels, inbox bypass)
- [x] Create email processing pipeline that orchestrates both stages
- [x] Test AI pipeline with real emails
- [x] Fixed checkpoint update to only happen when all messages process successfully
- [x] Implement Gmail label ID mapping for applying labels

## Phase 4: Email Processing Pipeline ✅
- [x] Build email monitoring service (watch for new emails)
- [x] Implement two-stage AI processing workflow
- [x] Add slug reuse logic (query past slugs from sender)
- [x] Store analysis results in database
- [x] Apply labels and actions to Gmail
- [x] Add error handling and retry logic

## Phase 5: Web UI - Basic Setup ✅
- [x] Set up web server (completed in Phase 2)
- [x] Refactor to use html/template instead of sprintf
- [x] Create base HTML templates with Pico CSS (https://picocss.com/ - lightweight, semantic HTML, no build tools)
- [x] Implement authentication (Google OAuth for web)
- [x] Create dashboard/home page
- [x] Add email processing history view
- [x] Build label configuration interface

## Phase 6: Web UI - Configuration ✅
- [x] Build system prompt configuration page (using Pico CSS forms)
- [x] Integrated custom prompts into AI processing pipeline
- [x] Fixed template naming collisions and database constraints
- [ ] Implement label reason configuration (add reasons to existing labels)
- [ ] Add edit functionality for labels (currently only create/delete)

## Phase 7: Self-Improvement System (In Progress)
- [x] Implement memory storage and retrieval
- [x] Create daily memory generation (analyzes yesterday's emails)
- [x] Integrate memories into AI prompts (provides context from past learnings)
- [x] Add UI to view and manually trigger memory generation
- [ ] Implement wrap-up report generator (8AM & 5PM)
- [ ] Build weekly memory consolidation (6PM Saturday)
- [ ] Build monthly memory consolidation (7PM 1st of month)
- [ ] Build yearly memory consolidation (8PM 1st of year)
- [ ] Create scheduler/cron system for timed tasks (auto-generate memories)

## Phase 8: Monitoring & Debugging
- [x] Add logging throughout application
- [x] Create email processing history view in UI
- [x] Build decision review page (see what AI decided)
- [ ] Add metrics/statistics dashboard
- [ ] Implement health check endpoint

## Phase 9: Testing & Documentation
- [ ] Write unit tests for core logic
- [ ] Write integration tests for Gmail/OpenAI
- [ ] Add README with setup instructions
- [ ] Document API endpoints
- [ ] Create deployment guide

## Phase 10: Future Enhancements
- [ ] Weekly journal generation
- [ ] Thumbs up/down feedback system
- [ ] Learn from human label changes
- [ ] Add email notes/meta suggestions
- [ ] Performance optimization
- [ ] Docker containerization
