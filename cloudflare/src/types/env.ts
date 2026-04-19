export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;

  // v1 queues
  EMAIL_QUEUE: Queue;
  BACKGROUND_QUEUE: Queue;

  // v2 pipeline queues
  TRIAGE_QUEUE: Queue;
  BUCKET_NEWSLETTER_QUEUE: Queue;
  BUCKET_NOTIFICATION_QUEUE: Queue;
  BUCKET_HUMAN_QUEUE: Queue;
  BUCKET_TRANSACTIONAL_QUEUE: Queue;
  BUCKET_SECURITY_QUEUE: Queue;
  BUCKET_CALENDAR_QUEUE: Queue;

  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URL: string;

  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;

  // Default model (used when a stage-specific var is unset).
  OPENAI_MODEL: string;

  // Per-stage model overrides. All optional — fall back to OPENAI_MODEL.
  OPENAI_MODEL_TRIAGE?: string;
  OPENAI_MODEL_NEWSLETTER?: string;
  OPENAI_MODEL_NOTIFICATION?: string;
  OPENAI_MODEL_HUMAN?: string;
  OPENAI_MODEL_TRANSACTIONAL?: string;
  OPENAI_MODEL_SECURITY?: string;
  OPENAI_MODEL_CALENDAR?: string;
  OPENAI_MODEL_SUMMARY?: string;
  OPENAI_MODEL_SENDER_RATING?: string;

  // Optional allow-listing so the deployed Worker only admits your account(s).
  ALLOWED_EMAILS?: string;    // comma-separated email allowlist
  ALLOWED_DOMAIN?: string;    // Google Workspace hd= param

  JWT_SECRET: string;
  SERVER_URL: string;
}
