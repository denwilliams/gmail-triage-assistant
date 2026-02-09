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
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Google OAuth credentials, OpenAI API key, and DATABASE_URL
   ```

4. **Authenticate with Gmail**
   ```bash
   make auth
   # Follow the prompts to authorize the application
   ```

5. **Build and run**
   ```bash
   make build
   make run
   ```

## Development Commands

```bash
make help              # Show all available commands
make auth              # Run OAuth authentication with Gmail
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
3. Enable the Gmail API
4. Create OAuth 2.0 credentials (Desktop application)
5. Download the credentials and use the Client ID and Client Secret in your `.env` file

## Project Structure

```
├── cmd/
│   ├── server/         # Application entry point
│   └── auth/           # OAuth authentication setup
├── internal/
│   ├── config/         # Configuration management
│   ├── database/       # Database models and queries
│   ├── gmail/          # Gmail API integration
│   ├── openai/         # OpenAI API integration
│   └── pipeline/       # Email processing pipeline
├── web/
│   ├── templates/      # HTMX templates
│   └── static/         # Static assets
└── migrations/         # Database migrations (PostgreSQL)
```

## Architecture

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Development Roadmap

See [TODO.md](TODO.md) for the complete development roadmap.

## License

See [LICENSE](LICENSE)
