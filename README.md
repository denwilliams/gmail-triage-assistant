# Gmail Triage Assistant

AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a two-stage AI pipeline with OpenAI.

## ✨ Features

- 🤖 **Two-Stage AI Processing**: Emails are analyzed for content, then actions are determined
- 🏷️ **Smart Labeling**: Automatically applies Gmail labels based on email content
- 📧 **Inbox Management**: Can bypass inbox (archive) emails that don't need immediate attention
- 👥 **Multi-User Support**: Each user has independent processing with their own configuration
- ⚙️ **Customizable AI Prompts**: Configure how the AI analyzes and processes emails
- 📊 **Processing History**: Review AI decisions and see why labels were applied
- 🎨 **Clean Web UI**: Built with Pico CSS for a lightweight, semantic interface
- 🔄 **Automatic Monitoring**: Polls Gmail every minute for new emails
- 🔐 **Secure OAuth**: Uses Google OAuth 2.0 for authentication

## Quick Start

### Prerequisites
- Go 1.21+
- PostgreSQL 14+
- Google Cloud Project with Gmail API enabled
- OpenAI API key

### Setup

1. **Clone and install dependencies**
   ```bash
   make deps
   ```

2. **Set up PostgreSQL database**
   ```bash
   # Create database
   createdb gmail_triage

   # Run migrations
   psql -d gmail_triage -f migrations/001_initial_schema.sql
   psql -d gmail_triage -f migrations/002_add_users.sql
   psql -d gmail_triage -f migrations/003_add_last_checked_at.sql

   # Add unique constraint for system prompts
   psql -d gmail_triage -c "CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_user_type ON system_prompts(user_id, type);"
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Google OAuth credentials, OpenAI API key, and DATABASE_URL
   ```

4. **Run the application**
   ```bash
   make run
   # Visit http://localhost:8080 and click "Sign in with Google"
   ```

## Development Commands

```bash
make help              # Show all available commands
make build             # Build the application
make run               # Run the application
make test              # Run tests
make lint              # Run linters
make fmt               # Format code
make clean             # Clean build artifacts
make install-tools     # Install development tools (air, golangci-lint)
```

## Gmail API Setup

To use this application, you need to set up a Google Cloud Project and enable the Gmail API:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Gmail API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Choose **Web application**
6. Add authorized redirect URI: `http://localhost:8080/auth/callback`
7. Download the credentials and use the Client ID and Client Secret in your `.env` file

## How It Works

### Two-Stage AI Pipeline

1. **Stage 1: Content Analysis**
   - Extracts sender, subject, and body from email
   - Generates a slug (category) for consistent classification
   - Identifies 3-5 keywords describing the content
   - Creates a one-sentence summary

2. **Stage 2: Action Determination**
   - Reviews available labels configured by the user
   - Decides which labels to apply based on content
   - Determines if email should bypass inbox (archive)
   - Provides reasoning for decisions

### User Workflow

1. Sign in with Google OAuth at http://localhost:8080
2. Configure labels at [/labels](http://localhost:8080/labels) (e.g., "Work", "Newsletter", "Urgent")
3. Optionally customize AI prompts at [/prompts](http://localhost:8080/prompts)
4. The system automatically monitors your Gmail and processes new emails
5. Review AI decisions at [/history](http://localhost:8080/history)
6. Check Gmail to see labels applied and emails archived

## Project Structure

```
├── cmd/server/         # Application entry point
├── internal/
│   ├── config/         # Configuration management
│   ├── database/       # Database models and queries (multi-user)
│   ├── gmail/          # Gmail API integration (multi-user monitor)
│   ├── openai/         # OpenAI API integration (two-stage pipeline)
│   ├── pipeline/       # Email processing pipeline orchestration
│   └── web/            # Web server with OAuth and Pico CSS UI
├── web/templates/      # HTML templates (home, dashboard, labels, prompts, history)
└── migrations/         # Database migrations (PostgreSQL)
```

## Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# Database
DATABASE_URL=postgres://user:password@localhost:5432/gmail_triage?sslmode=disable

# Google OAuth (Web Application)
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URL=http://localhost:8080/auth/callback

# OpenAI
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-4.1-nano  # or gpt-4-turbo, gpt-3.5-turbo

# Server
SERVER_HOST=localhost
SERVER_PORT=8080
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Development Roadmap

See [TODO.md](TODO.md) for the complete development roadmap.

## License

See [LICENSE](LICENSE)
