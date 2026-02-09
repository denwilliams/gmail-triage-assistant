# Gmail Triage Assistant

AI-powered email management system that automatically categorizes, labels, and processes Gmail messages using a multi-stage AI pipeline.

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

1. Users visit the web interface and sign in with Google
2. OAuth tokens are stored securely in the database per user
3. The application monitors Gmail for all authenticated users
4. Each user's emails are processed independently with their own AI configuration
5. Users can configure prompts, labels, and processing rules via the web UI

## Project Structure

```
├── cmd/server/         # Application entry point
├── internal/
│   ├── config/         # Configuration management
│   ├── database/       # Database models and queries (multi-user)
│   ├── gmail/          # Gmail API integration (multi-user monitor)
│   ├── web/            # Web server with OAuth and Pico CSS UI
│   ├── openai/         # OpenAI API integration (TODO)
│   └── pipeline/       # Email processing pipeline (TODO)
└── migrations/         # Database migrations (PostgreSQL)
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Development Roadmap

See [TODO.md](TODO.md) for the complete development roadmap.

## License

See [LICENSE](LICENSE)
