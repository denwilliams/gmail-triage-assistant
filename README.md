# Gmail Triage Assistant

AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a two-stage AI pipeline with self-improving hierarchical memory.

## 📊 System Architecture

### Email Processing Pipeline

```mermaid
graph TD
    A[New Email Arrives] --> B[Stage 1: Content Analysis]
    B --> C{Get Past Slugs<br/>from Sender}
    C --> D[AI Generates:<br/>- Slug<br/>- Keywords<br/>- Summary]
    D --> E[Stage 2: Action Generation]
    E --> F{Get User Labels<br/>& Descriptions}
    F --> G{Get Memory<br/>Context}
    G --> H[AI Determines:<br/>- Labels to Apply<br/>- Bypass Inbox?<br/>- Reasoning]
    H --> I[Apply Actions<br/>to Gmail]
    I --> J[Store Results<br/>in Database]

    style B fill:#e1f5ff
    style E fill:#e1f5ff
    style I fill:#d4edda
    style J fill:#d4edda
```

### Slug Feedback Loop

```mermaid
graph LR
    A[Email from<br/>sender@example.com] --> B[Query Past Slugs<br/>from This Sender]
    B --> C[AI Sees Previous<br/>Categorizations]
    C --> D[Reuses Existing Slug<br/>or Creates New]
    D --> E[Store Slug with<br/>Email & Sender]
    E --> F[Future Emails<br/>from Sender]
    F --> B

    style B fill:#fff3cd
    style E fill:#d4edda
```

### Hierarchical Memory System

```mermaid
graph TD
    A[Emails Processed Daily] --> B[5PM: Daily Memory<br/>Analyze patterns & insights]
    B --> C[Database: 7 Daily Memories]
    C --> D[6PM Saturday:<br/>Weekly Memory<br/>Consolidate daily insights]
    D --> E[Database: ~4 Weekly Memories]
    E --> F[7PM 1st of Month:<br/>Monthly Memory<br/>Consolidate weekly insights]
    F --> G[Database: 12 Monthly Memories]
    G --> H[8PM January 1st:<br/>Yearly Memory<br/>Consolidate monthly insights]
    H --> I[Database: Yearly Memories]

    I --> J{Memory Context<br/>Retrieval}
    C --> J
    E --> J
    G --> J

    J --> K[Stage 1 & 2 AI<br/>Uses Memory Context]
    K --> A

    style B fill:#e1f5ff
    style D fill:#e1f5ff
    style F fill:#e1f5ff
    style H fill:#e1f5ff
    style K fill:#d4edda
```

### Daily Schedule

```mermaid
gantt
    title Automated Tasks Schedule
    dateFormat HH:mm
    axisFormat %H:%M

    section Daily
    Morning Wrapup              :milestone, 08:00, 0m
    Evening Wrapup + Daily Memory :milestone, 17:00, 0m

    section Weekly
    Weekly Memory (Saturday)    :milestone, 18:00, 0m

    section Monthly
    Monthly Memory (1st)        :milestone, 19:00, 0m

    section Yearly
    Yearly Memory (Jan 1st)     :milestone, 20:00, 0m
```

## ✨ Features

- 🤖 **Two-Stage AI Processing**: Content analysis → Action determination
- 🏷️ **Smart Labeling**: Automatically applies Gmail labels based on email content
- 📧 **Inbox Management**: Archives emails that don't need immediate attention
- 🧠 **Self-Improving Memory**: Hierarchical learning system (daily → weekly → monthly → yearly)
- 🔄 **Slug Consistency**: Reuses past categorizations for consistent handling
- 📊 **Wrapup Reports**: Morning (8AM) and evening (5PM) summaries of processed emails
- 👥 **Multi-User Support**: Each user has independent processing and configuration
- ⚙️ **Customizable AI Prompts**: Configure how AI analyzes emails and generates memories
- 📈 **Processing History**: Review AI decisions with full reasoning
- 🎨 **Clean Web UI**: Built with Pico CSS for a lightweight, semantic interface
- 🔐 **Secure OAuth**: Uses Google OAuth 2.0 for authentication
- ⏰ **Automatic Scheduling**: Background tasks run at scheduled times

## 🚀 Quick Start

### Prerequisites

- **Go 1.24+** - [Install Go](https://go.dev/doc/install)
- **PostgreSQL 14+** - [Install PostgreSQL](https://www.postgresql.org/download/)
- **Google Cloud Project** - [Console](https://console.cloud.google.com/) with Gmail API enabled
- **OpenAI API Key** - [Get API Key](https://platform.openai.com/api-keys)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/gmail-triage-assistant.git
   cd gmail-triage-assistant
   ```

2. **Set up PostgreSQL database**
   ```bash
   # Create database
   createdb gmail_triage

   # Migrations run automatically on startup, no manual SQL needed!
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials (see Environment Variables section below)
   ```

4. **Build and run**
   ```bash
   make build
   ./bin/gmail-triage-assistant
   ```

5. **Open browser and authenticate**
   ```
   Visit http://localhost:8080
   Click "Sign in with Google"
   ```

6. **Configure labels**
   - Go to http://localhost:8080/labels
   - Add labels like "Work", "Newsletter", "Urgent", etc.
   - Add descriptions to guide the AI (e.g., "Urgent: Time-sensitive emails requiring immediate attention")

7. **Watch it work!**
   - System monitors your Gmail every 5 minutes
   - Check http://localhost:8080/history to see AI decisions
   - View memories at http://localhost:8080/memories

## 📋 Environment Variables

Create a `.env` file in the project root:

```bash
# Database
DATABASE_URL=postgres://user:password@localhost:5432/gmail_triage?sslmode=disable

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URL=http://localhost:8080/auth/callback

# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5-nano
# Optional: OPENAI_BASE_URL=https://api.openai.com/v1

# Server
SERVER_HOST=localhost
SERVER_PORT=8080

# Gmail Monitoring
GMAIL_CHECK_INTERVAL=5  # Check every 5 minutes

# Debug (optional)
DEBUG=OPENAI  # Logs all AI prompts when set
```

## 🔧 Gmail API Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Gmail API**:
   - Navigate to "APIs & Services" → "Library"
   - Search for "Gmail API"
   - Click "Enable"
4. Create OAuth 2.0 credentials:
   - Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:8080/auth/callback`
   - Click "Create"
5. Copy the **Client ID** and **Client Secret** to your `.env` file

**Note**: For production deployment, add your production domain to authorized redirect URIs (e.g., `https://yourdomain.com/auth/callback`)

## 🏗️ Architecture Deep Dive

### Email Processing Pipeline

1. **Multi-User Monitor** (`internal/gmail/multi_user_monitor.go`)
   - Polls Gmail for all active users every N minutes
   - Uses history ID to track new messages efficiently
   - Automatically refreshes OAuth tokens when expired

2. **Stage 1: Content Analysis** (`internal/openai/client.go` - `AnalyzeEmail`)
   - Fetches past slugs from same sender for consistency
   - Retrieves memory context (yearly/monthly/weekly/daily)
   - AI generates: slug, keywords, summary
   - Uses OpenAI JSON Schema for structured output

3. **Stage 2: Action Generation** (`internal/openai/client.go` - `DetermineActions`)
   - Fetches user's configured labels with descriptions
   - Includes memory context for learning-informed decisions
   - AI determines: labels to apply, whether to bypass inbox, reasoning
   - Uses OpenAI JSON Schema for guaranteed valid responses

4. **Gmail Integration** (`internal/gmail/client.go`)
   - Applies labels to emails
   - Archives emails (bypasses inbox) when determined
   - All operations use Gmail API v1

5. **Database Storage** (`internal/database/`)
   - Stores all analysis results with reasoning
   - Maintains slug history per sender
   - Saves memories and wrapup reports
   - PostgreSQL with JSONB for arrays (keywords, labels)

### Self-Improvement System

The system learns from email processing patterns through a hierarchical memory consolidation strategy:

| Memory Level | Schedule | Source Data | Purpose |
|--------------|----------|-------------|---------|
| **Daily** | 5PM Daily | Yesterday's processed emails | Identify patterns in email types, sender behaviors, labeling effectiveness |
| **Weekly** | 6PM Saturday | Past 7 daily memories | Consolidate weekly trends, recurring senders, categorization improvements |
| **Monthly** | 7PM 1st of Month | Past ~4 weekly memories | Higher-level insights, monthly patterns, strategic improvements |
| **Yearly** | 8PM Jan 1st | Past 12 monthly memories | Long-term learning, annual trends, major behavioral changes |

**Memory Retrieval**: When processing emails, the AI receives context from:
- 1 most recent yearly memory
- 1 most recent monthly memory
- 1 most recent weekly memory
- 7 most recent daily memories

This provides ~10 context points spanning multiple time scales, enabling the AI to make decisions informed by both recent and long-term patterns.

### Wrapup Reports

Separate from memories, wrapup reports provide human-readable summaries:

- **8AM Morning Wrapup**: Summary of emails processed since 5PM yesterday
- **5PM Evening Wrapup**: Summary of emails processed since 8AM today

These are stored in the `wrapup_reports` table and can be viewed via the web UI (future enhancement).

## 📁 Project Structure

```
.
├── cmd/
│   └── server/              # Application entry point
│       └── main.go          # Initializes all services and starts monitoring
├── internal/
│   ├── config/              # Configuration management (.env loading)
│   ├── database/            # PostgreSQL integration
│   │   ├── migrations.go    # Auto-migration system (embedded SQL)
│   │   ├── models.go        # Data models (User, Email, Label, Memory, etc.)
│   │   ├── emails.go        # Email CRUD operations
│   │   ├── labels.go        # Label management
│   │   ├── memories.go      # Memory storage and retrieval
│   │   ├── system_prompts.go # Custom prompt management
│   │   └── users.go         # User management
│   ├── gmail/               # Gmail API integration
│   │   ├── client.go        # Gmail operations (fetch, label, archive)
│   │   └── multi_user_monitor.go # Polls Gmail for all users
│   ├── openai/              # OpenAI API integration
│   │   └── client.go        # Two-stage AI pipeline with JSON Schema
│   ├── pipeline/            # Email processing orchestration
│   │   └── processor.go     # Coordinates Stage 1 → Stage 2 → Gmail
│   ├── memory/              # Memory generation system
│   │   └── service.go       # Daily/weekly/monthly/yearly memory generation
│   ├── wrapup/              # Wrapup report generation
│   │   └── service.go       # Morning/evening report generation
│   ├── scheduler/           # Automated task scheduling
│   │   └── scheduler.go     # Runs memories and wrapups at scheduled times
│   └── web/                 # Web server and UI
│       ├── server.go        # HTTP routes and OAuth handlers
│       └── templates/       # HTML templates (embedded in binary)
│           ├── base.html    # Base layout with Pico CSS
│           ├── home.html    # Landing page
│           ├── dashboard.html # User dashboard
│           ├── labels.html  # Label management
│           ├── prompts.html # System prompt configuration
│           ├── history.html # Email processing history
│           └── memories.html # Memory viewer
├── migrations/              # SQL migrations (embedded in binary)
│   ├── 001_initial_schema.sql
│   ├── 002_add_users.sql
│   ├── 003_add_last_checked_at.sql
│   ├── 004_add_wrapup_reports.sql
│   ├── 005_fix_system_prompts_constraint.sql
│   └── 006_add_reasoning_to_emails.sql
├── Makefile                 # Build automation
├── CLAUDE.md                # AI assistant guidance (architecture overview)
├── TODO.md                  # Development roadmap
├── IMPLEMENTATION_NOTES.md  # Recent implementation details
└── README.md                # This file
```

## 🛠️ Development

### Available Commands

```bash
make build             # Build the binary
make run               # Run the application
make test              # Run tests
make lint              # Run linters
make fmt               # Format code
make clean             # Clean build artifacts
make install-tools     # Install dev tools (golangci-lint, air)
make help              # Show all commands
```

### Hot Reload (Development)

```bash
make install-tools     # Install 'air' hot reload tool
air                    # Starts with auto-reload on file changes
```

### Building for Raspberry Pi 5

The project includes GitHub Actions that automatically build for:
- Linux AMD64
- Linux ARM64 (Raspberry Pi 5)

Manual build:
```bash
GOOS=linux GOARCH=arm64 go build -o bin/gmail-triage-assistant-arm64 cmd/server/main.go
```

### Database Migrations

Migrations are **embedded** in the binary and run automatically on startup. No manual SQL execution needed!

Location: `internal/database/migrations/*.sql`

The migration system:
- Tracks applied migrations in `schema_migrations` table
- Skips already-applied migrations
- Runs new migrations in order
- Idempotent (safe to run multiple times)

### Adding a New Migration

1. Create `internal/database/migrations/007_your_migration.sql`
2. Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
3. Restart the application - it will auto-apply

Example:
```sql
-- 007_add_feedback.sql
CREATE TABLE IF NOT EXISTS email_feedback (
    id SERIAL PRIMARY KEY,
    email_id VARCHAR(255) NOT NULL REFERENCES emails(id),
    user_id BIGINT NOT NULL REFERENCES users(id),
    feedback VARCHAR(20) NOT NULL CHECK (feedback IN ('thumbs_up', 'thumbs_down')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_feedback_email_id ON email_feedback(email_id);
```

### Customizing System Prompts

Navigate to http://localhost:8080/prompts to customize how the AI behaves:

- **Email Analysis** (Stage 1): Controls slug generation, keyword extraction
- **Email Actions** (Stage 2): Controls label application, inbox bypass decisions
- **Daily Review**: Customizes daily memory insights
- **Weekly/Monthly/Yearly Summary**: Customizes memory consolidation
- **Wrapup Report**: Customizes morning/evening summaries

Tips:
- Be specific about what patterns you want the AI to notice
- Use examples in your prompts ("e.g., newsletters should be archived")
- Prompts support markdown for better AI comprehension

### Debug Mode

Enable detailed logging of AI prompts:

```bash
DEBUG=OPENAI ./bin/gmail-triage-assistant
```

This logs all system and user prompts sent to OpenAI, useful for:
- Understanding what context the AI receives
- Debugging unexpected categorizations
- Optimizing your custom prompts

## 🧪 Testing

### Manual Testing Workflow

1. **Test Email Processing**:
   - Send yourself a test email
   - Wait up to 5 minutes for next Gmail poll
   - Check http://localhost:8080/history
   - Verify labels applied in Gmail

2. **Test Memory Generation**:
   - Process several emails throughout a day
   - Manually trigger daily memory:
     ```bash
     curl -X POST "http://localhost:8080/api/memories/generate?user_id=1"
     ```
   - View at http://localhost:8080/memories

3. **Test Slug Reuse**:
   - Send email from sender A
   - Note the slug assigned (check history)
   - Send another email from sender A
   - Verify same/similar slug used

### Unit Tests (Future)

```bash
make test              # Run all tests
go test ./internal/... # Test specific packages
```

## 📊 Monitoring & Observability

### Logs

The application logs all major operations:

```
2026/02/10 21:41:41 Starting Gmail Triage Assistant...
2026/02/10 21:41:41 ✓ Database connected successfully
2026/02/10 21:41:41 ✓ Scheduler initialized:
2026/02/10 21:41:41   - 8AM: Morning wrapup
2026/02/10 21:41:41   - 5PM: Evening wrapup + daily memory
2026/02/10 21:41:41   - 6PM Saturday: Weekly memory
2026/02/10 21:41:41   - 7PM 1st: Monthly memory
2026/02/10 21:41:41   - 8PM Jan 1st: Yearly memory
2026/02/10 21:41:41 Checking Gmail for 1 active user(s)
```

### Database Queries

Useful queries for monitoring:

```sql
-- Check recent email processing
SELECT from_address, subject, slug, labels_applied, processed_at
FROM emails
WHERE user_id = 1
ORDER BY processed_at DESC
LIMIT 10;

-- View memory history
SELECT type, start_date, end_date, content
FROM memories
WHERE user_id = 1
ORDER BY created_at DESC;

-- Check wrapup reports
SELECT report_time, email_count, content
FROM wrapup_reports
WHERE user_id = 1
ORDER BY report_time DESC;

-- Most common slugs
SELECT slug, COUNT(*) as count
FROM emails
WHERE user_id = 1
GROUP BY slug
ORDER BY count DESC
LIMIT 20;
```

## 🚢 Deployment

### Single Binary Deployment

The application compiles to a single binary with all templates and migrations embedded:

```bash
make build
scp bin/gmail-triage-assistant user@server:/opt/gmail-triage/
```

### Systemd Service (Linux)

Create `/etc/systemd/system/gmail-triage.service`:

```ini
[Unit]
Description=Gmail Triage Assistant
After=network.target postgresql.service

[Service]
Type=simple
User=gmail-triage
WorkingDirectory=/opt/gmail-triage
Environment="DATABASE_URL=postgres://user:pass@localhost/gmail_triage"
Environment="GOOGLE_CLIENT_ID=your-id"
Environment="GOOGLE_CLIENT_SECRET=your-secret"
Environment="GOOGLE_REDIRECT_URL=https://yourdomain.com/auth/callback"
Environment="OPENAI_API_KEY=sk-your-key"
Environment="OPENAI_MODEL=gpt-5-nano"
Environment="SERVER_HOST=0.0.0.0"
Environment="SERVER_PORT=8080"
ExecStart=/opt/gmail-triage/gmail-triage-assistant
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gmail-triage
sudo systemctl start gmail-triage
sudo systemctl status gmail-triage
```

### Raspberry Pi Deployment

Perfect for home server deployment:

1. Download ARM64 binary from GitHub releases
2. Copy to Pi: `scp gmail-triage-assistant-linux-arm64 pi@raspberrypi:/home/pi/`
3. Create systemd service (as above)
4. Run PostgreSQL on Pi or point to remote database

**Memory usage**: ~50MB RAM (Go + small memory footprint)

### Docker (Future)

```bash
docker build -t gmail-triage-assistant .
docker run -d \
  --name gmail-triage \
  -p 8080:8080 \
  -e DATABASE_URL="postgres://..." \
  -e GOOGLE_CLIENT_ID="..." \
  gmail-triage-assistant
```

## 🤔 FAQ

### Why are emails not being processed?

1. Check OAuth token is valid (try re-authenticating)
2. Verify Gmail API is enabled in Google Cloud Console
3. Check logs for errors: `journalctl -u gmail-triage -f`
4. Ensure Gmail check interval hasn't been set too high

### Can I change how often Gmail is checked?

Yes, set `GMAIL_CHECK_INTERVAL=1` in `.env` for 1-minute intervals (default is 5).

### How do I reset the system?

```sql
-- Clear all processing history but keep config
TRUNCATE emails, memories, wrapup_reports CASCADE;

-- Full reset (deletes everything including users/labels)
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
-- Restart app to re-run migrations
```

### Can multiple users use the same instance?

Yes! Each user signs in with their own Google account. They get:
- Independent email processing
- Separate label configurations
- Individual memories and wrapup reports
- Isolated processing history

### Does this modify my emails?

No. The system only:
- Applies labels (non-destructive)
- Archives emails (moves to "All Mail", reversible)
- **Never deletes or modifies email content**

### What happens if OpenAI is down?

- Emails remain unprocessed
- System retries on next Gmail poll (5 minutes later)
- No data loss - Gmail history ID tracking ensures no emails are skipped

### How much does this cost to run?

**OpenAI Costs** (using `gpt-5-nano`):
- ~$0.0001 per email processed (2 API calls)
- Processing 100 emails/day ≈ $0.30/month
- Memory generation ≈ $0.10/month
- **Total: ~$0.40/month** for moderate usage

**Infrastructure**:
- Raspberry Pi 5: One-time $80
- Or cloud VPS: $5-10/month

### Can I run this without memories?

Yes, the system works without memories. They're optional enhancements that improve AI decisions over time.

To disable scheduled memory generation, comment out the scheduler start in `cmd/server/main.go`.

## 🗺️ Roadmap

See [TODO.md](TODO.md) for the complete development roadmap.

**Upcoming features**:
- ✅ ~~Hierarchical memory system~~ (Complete!)
- 📊 Metrics and statistics dashboard
- 👍 Thumbs up/down feedback for AI decisions
- 📝 Weekly journal generation (human-readable summaries)
- 🔄 Learn from manual label changes
- 🐳 Docker containerization
- 📱 Mobile-friendly UI improvements

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) - AI processing
- [Google Gmail API](https://developers.google.com/gmail) - Email integration
- [Pico CSS](https://picocss.com/) - Lightweight UI framework
- Built with ❤️ and [Claude Code](https://claude.com/code)

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/gmail-triage-assistant/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/gmail-triage-assistant/discussions)
- **Email**: your-email@example.com

---

**Made with 🤖 AI assistance** - This project demonstrates how AI can augment human productivity without replacing human decision-making.
