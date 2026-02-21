import type { Email } from '../types'

function parseEmail(row: Record<string, unknown>): Email {
  return {
    ...(row as unknown as Email),
    keywords: JSON.parse((row.keywords as string) || '[]'),
    labels_applied: JSON.parse((row.labels_applied as string) || '[]'),
    bypassed_inbox: Boolean(row.bypassed_inbox),
  }
}

export async function createEmail(db: D1Database, email: Omit<Email, 'created_at'>): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT OR IGNORE INTO emails
      (id, user_id, from_address, subject, slug, keywords, summary, labels_applied,
       bypassed_inbox, reasoning, human_feedback, processed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    email.id, email.user_id, email.from_address, email.subject, email.slug,
    JSON.stringify(email.keywords), email.summary, JSON.stringify(email.labels_applied),
    email.bypassed_inbox ? 1 : 0, email.reasoning, email.human_feedback,
    email.processed_at, now
  ).run()
}

export async function emailExists(db: D1Database, emailId: string): Promise<boolean> {
  const result = await db.prepare('SELECT 1 FROM emails WHERE id = ?').bind(emailId).first()
  return result !== null
}

export async function getRecentEmails(db: D1Database, userId: number, limit = 50): Promise<Email[]> {
  const result = await db.prepare(`
    SELECT * FROM emails WHERE user_id = ? ORDER BY processed_at DESC LIMIT ?
  `).bind(userId, limit).all()
  return result.results.map(parseEmail)
}

export async function getEmailsByDateRange(
  db: D1Database, userId: number, start: string, end: string
): Promise<Email[]> {
  const result = await db.prepare(`
    SELECT * FROM emails WHERE user_id = ? AND processed_at >= ? AND processed_at < ?
    ORDER BY processed_at ASC
  `).bind(userId, start, end).all()
  return result.results.map(parseEmail)
}

export async function getPastSlugsFromSender(
  db: D1Database, userId: number, fromAddress: string, limit = 5
): Promise<string[]> {
  const result = await db.prepare(`
    SELECT DISTINCT slug FROM emails WHERE user_id = ? AND from_address = ?
    ORDER BY processed_at DESC LIMIT ?
  `).bind(userId, fromAddress, limit).all<{ slug: string }>()
  return result.results.map(r => r.slug)
}

export async function updateEmailFeedback(
  db: D1Database, userId: number, emailId: string, feedback: string
): Promise<void> {
  await db.prepare(`
    UPDATE emails SET human_feedback = ? WHERE id = ? AND user_id = ?
  `).bind(feedback, emailId, userId).run()
}
