export interface Env {
  DB: D1Database;
  EMAIL_QUEUE: Queue;
  BACKGROUND_QUEUE: Queue;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URL: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_BASE_URL: string;
  JWT_SECRET: string;
  SERVER_URL: string;
}
