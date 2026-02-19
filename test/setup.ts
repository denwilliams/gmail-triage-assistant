import { env } from 'cloudflare:test'

const statements = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    google_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    gmail_history_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    from_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    slug TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    labels_applied TEXT NOT NULL DEFAULT '[]',
    bypassed_inbox INTEGER NOT NULL DEFAULT 0,
    reasoning TEXT NOT NULL DEFAULT '',
    human_feedback TEXT NOT NULL DEFAULT '',
    processed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_from_address ON emails(from_address)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_processed_at ON emails(processed_at)`,
  `CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS system_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN (
      'email_analyze', 'email_actions', 'daily_review',
      'weekly_summary', 'monthly_summary', 'yearly_summary', 'wrapup_report'
    )),
    content TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('daily', 'weekly', 'monthly', 'yearly')),
    content TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_dates ON memories(start_date, end_date)`,
  `CREATE TABLE IF NOT EXISTS wrapup_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    report_type TEXT NOT NULL DEFAULT 'morning',
    email_count INTEGER NOT NULL,
    content TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
]

export async function applySchema(db: D1Database) {
  for (const sql of statements) {
    await db.prepare(sql).run()
  }
}
