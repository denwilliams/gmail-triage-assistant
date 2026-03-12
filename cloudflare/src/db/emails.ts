import type { Email, EmailRow } from '../types/models';

function mapEmail(row: EmailRow): Email {
  return {
    id: row.id,
    userId: row.user_id,
    fromAddress: row.from_address,
    fromDomain: row.from_domain,
    subject: row.subject,
    slug: row.slug,
    keywords: safeParseJSON<string[]>(row.keywords, []),
    summary: row.summary,
    labelsApplied: safeParseJSON<string[]>(row.labels_applied, []),
    bypassedInbox: row.bypassed_inbox === 1,
    reasoning: row.reasoning ?? '',
    humanFeedback: row.human_feedback ?? '',
    feedbackDirty: (row.feedback_dirty ?? 0) === 1,
    notificationSent: row.notification_sent === 1,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  };
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export async function emailExists(db: D1Database, emailId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM emails WHERE id = ?')
    .bind(emailId)
    .first<{ '1': number }>();
  return row !== null;
}

export async function createEmail(db: D1Database, email: Email): Promise<void> {
  await db
    .prepare(
      `INSERT INTO emails (id, user_id, from_address, from_domain, subject, slug, keywords, summary,
        labels_applied, bypassed_inbox, reasoning, notification_sent, processed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      email.id,
      email.userId,
      email.fromAddress,
      email.fromDomain,
      email.subject,
      email.slug,
      JSON.stringify(email.keywords),
      email.summary,
      JSON.stringify(email.labelsApplied),
      email.bypassedInbox ? 1 : 0,
      email.reasoning,
      email.notificationSent ? 1 : 0,
      email.processedAt,
      email.createdAt,
    )
    .run();
}

export async function getRecentEmails(
  db: D1Database,
  userId: number,
  limit: number,
  offset: number,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, from_address, from_domain, subject, slug, keywords, summary,
              labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, '') as human_feedback,
              COALESCE(feedback_dirty, 0) as feedback_dirty, notification_sent, processed_at, created_at
       FROM emails
       WHERE user_id = ?
       ORDER BY processed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function updateEmailFeedback(
  db: D1Database,
  userId: number,
  emailId: string,
  feedback: string,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE emails SET human_feedback = ?, feedback_dirty = (? != '')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(feedback, feedback, emailId, userId)
    .run();

  if (result.meta.changes === 0) {
    throw new Error('email not found or unauthorized');
  }
}

export async function getUserLabels(db: D1Database, userId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT name FROM labels WHERE user_id = ? ORDER BY name')
    .bind(userId)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

export async function getEmailsByDateRange(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, from_address, from_domain, subject, slug, keywords, summary,
              labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, '') as human_feedback,
              COALESCE(feedback_dirty, 0) as feedback_dirty, notification_sent, processed_at, created_at
       FROM emails
       WHERE user_id = ? AND processed_at >= ? AND processed_at < ?
       ORDER BY processed_at ASC`,
    )
    .bind(userId, startDate, endDate)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function getEmailsWithDirtyFeedback(db: D1Database, userId: number): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, from_address, from_domain, subject, slug, keywords, summary,
              labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, '') as human_feedback,
              COALESCE(feedback_dirty, 0) as feedback_dirty, notification_sent, processed_at, created_at
       FROM emails
       WHERE user_id = ? AND feedback_dirty = 1
       ORDER BY processed_at ASC`,
    )
    .bind(userId)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function clearFeedbackDirty(db: D1Database, userId: number, _emailIds: string[]): Promise<void> {
  if (_emailIds.length === 0) return;
  await db
    .prepare('UPDATE emails SET feedback_dirty = 0 WHERE user_id = ? AND feedback_dirty = 1')
    .bind(userId)
    .run();
}

export async function getHistoricalEmailsFromAddress(
  db: D1Database,
  userId: number,
  address: string,
  limit: number,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, from_address, from_domain, subject, slug, keywords, summary,
              labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, '') as human_feedback,
              COALESCE(feedback_dirty, 0) as feedback_dirty, notification_sent, processed_at, created_at
       FROM emails
       WHERE user_id = ? AND from_address = ?
       ORDER BY processed_at DESC
       LIMIT ?`,
    )
    .bind(userId, address, limit)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function getHistoricalEmailsFromDomain(
  db: D1Database,
  userId: number,
  domain: string,
  limit: number,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, from_address, from_domain, subject, slug, keywords, summary,
              labels_applied, bypassed_inbox, reasoning, COALESCE(human_feedback, '') as human_feedback,
              COALESCE(feedback_dirty, 0) as feedback_dirty, notification_sent, processed_at, created_at
       FROM emails
       WHERE user_id = ? AND from_domain = ?
       ORDER BY processed_at DESC
       LIMIT ?`,
    )
    .bind(userId, domain, limit)
    .all<EmailRow>();
  return results.map(mapEmail);
}
