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
- [x] Implement Google OAuth flow
- [x] Create Gmail API client wrapper
- [x] Implement email fetching (monitor new emails)
- [x] Implement email labeling operations
- [x] Implement inbox bypass functionality
- [ ] Test Gmail API integration with real mailbox (requires actual Gmail account setup)

## Phase 3: OpenAI Integration
- [ ] Create OpenAI client wrapper (nano v5 models)
- [ ] Implement Stage 1 AI: Content analysis (slug, keywords, summary)
- [ ] Implement Stage 2 AI: Action generation (labels, inbox bypass)
- [ ] Create prompt templates and configuration system
- [ ] Test AI pipeline with sample emails

## Phase 4: Email Processing Pipeline
- [ ] Build email monitoring service (watch for new emails)
- [ ] Implement two-stage AI processing workflow
- [ ] Add slug reuse logic (query past slugs from sender)
- [ ] Store analysis results in database
- [ ] Apply labels and actions to Gmail
- [ ] Add error handling and retry logic
- [ ] Implement processing queue/worker pattern

## Phase 5: Web UI - Basic Setup
- [ ] Set up HTMX web server
- [ ] Create base HTML templates
- [ ] Implement authentication (Google OAuth for web)
- [ ] Create dashboard/home page

## Phase 6: Web UI - Configuration
- [ ] Build system prompt configuration page
- [ ] Create label management interface (add/edit/delete)
- [ ] Implement label reason configuration
- [ ] Add configuration persistence to database
- [ ] Test configuration changes affect AI processing

## Phase 7: Self-Improvement System
- [ ] Implement wrap-up report generator (8AM & 5PM)
- [ ] Create daily review process (5PM - analyze decisions)
- [ ] Implement memory storage and retrieval
- [ ] Build weekly memory consolidation (6PM Saturday)
- [ ] Build monthly memory consolidation (7PM 1st of month)
- [ ] Build yearly memory consolidation (8PM 1st of year)
- [ ] Create scheduler/cron system for timed tasks
- [ ] Integrate memories into AI prompts

## Phase 8: Monitoring & Debugging
- [ ] Add logging throughout application
- [ ] Create email processing history view in UI
- [ ] Build decision review page (see what AI decided)
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
