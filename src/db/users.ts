import type { User } from '../types'

type CreateUserInput = {
  email: string
  google_id: string
  access_token: string
  refresh_token: string
  token_expiry: string
}

export async function getUserByGoogleId(db: D1Database, googleId: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first<User>()
}

export async function getUser(db: D1Database, userId: number): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>()
}

export async function getActiveUsers(db: D1Database): Promise<User[]> {
  const result = await db.prepare('SELECT * FROM users WHERE is_active = 1').all<User>()
  return result.results
}

export async function createUser(db: D1Database, input: CreateUserInput): Promise<User> {
  const now = new Date().toISOString()
  const result = await db.prepare(`
    INSERT INTO users (email, google_id, access_token, refresh_token, token_expiry, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).bind(input.email, input.google_id, input.access_token, input.refresh_token, input.token_expiry, now, now)
    .first<User>()

  if (!result) throw new Error('Failed to create user')
  return result
}

export async function updateUserToken(
  db: D1Database,
  userId: number,
  accessToken: string,
  refreshToken: string,
  tokenExpiry: string
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    UPDATE users SET access_token = ?, refresh_token = ?, token_expiry = ?, updated_at = ?
    WHERE id = ?
  `).bind(accessToken, refreshToken, tokenExpiry, now, userId).run()
}

export async function updateGmailHistoryId(
  db: D1Database,
  userId: number,
  historyId: string
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    UPDATE users SET gmail_history_id = ?, last_checked_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(historyId, now, now, userId).run()
}
