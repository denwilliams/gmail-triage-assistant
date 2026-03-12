import type { User, UserRow } from '../types/models';

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    googleId: row.google_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    tokenExpiry: row.token_expiry,
    isActive: row.is_active === 1,
    lastCheckedAt: row.last_checked_at,
    pushoverUserKey: row.pushover_user_key,
    pushoverAppToken: row.pushover_app_token,
    webhookUrl: row.webhook_url,
    webhookHeaderKey: row.webhook_header_key,
    webhookHeaderValue: row.webhook_header_value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createUser(
  db: D1Database,
  email: string,
  googleId: string,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string,
): Promise<User> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO users (email, google_id, access_token, refresh_token, token_expiry, is_active,
        pushover_user_key, pushover_app_token, webhook_url, webhook_header_key, webhook_header_value,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, '', '', '', '', '', ?, ?)
       RETURNING *`,
    )
    .bind(email, googleId, accessToken, refreshToken, tokenExpiry, now, now)
    .first<UserRow>();

  if (!row) throw new Error('Failed to create user');
  return mapUser(row);
}

export async function getUserByID(db: D1Database, id: number): Promise<User | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function getUserByGoogleID(db: D1Database, googleId: string): Promise<User | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE google_id = ?')
    .bind(googleId)
    .first<UserRow>();
  return row ? mapUser(row) : null;
}

export async function updateUserToken(
  db: D1Database,
  userId: number,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE users SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = ? WHERE id = ?')
    .bind(accessToken, refreshToken, tokenExpiry, now, userId)
    .run();
}

export async function getAllActiveUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY created_at ASC')
    .all<UserRow>();
  return results.map(mapUser);
}

export async function getActiveUsers(db: D1Database): Promise<User[]> {
  const { results } = await db
    .prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY email')
    .all<UserRow>();
  return results.map(mapUser);
}

export async function updateLastCheckedAt(db: D1Database, userId: number, checkedAt: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE users SET last_checked_at = ?, updated_at = ? WHERE id = ?')
    .bind(checkedAt, now, userId)
    .run();
}

export async function setUserActive(db: D1Database, userId: number, isActive: boolean): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?')
    .bind(isActive ? 1 : 0, now, userId)
    .run();
}

export async function updatePushoverConfig(
  db: D1Database,
  userId: number,
  userKey: string,
  appToken: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare('UPDATE users SET pushover_user_key = ?, pushover_app_token = ?, updated_at = ? WHERE id = ?')
    .bind(userKey, appToken, now, userId)
    .run();
}

export async function updateWebhookConfig(
  db: D1Database,
  userId: number,
  url: string,
  headerKey: string,
  headerValue: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      'UPDATE users SET webhook_url = ?, webhook_header_key = ?, webhook_header_value = ?, updated_at = ? WHERE id = ?',
    )
    .bind(url, headerKey, headerValue, now, userId)
    .run();
}
