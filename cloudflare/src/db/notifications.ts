import type { Notification, NotificationRow } from '../types/models';

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    emailId: row.email_id,
    fromAddress: row.from_address,
    subject: row.subject,
    message: row.message,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

export async function createNotification(
  db: D1Database,
  notification: Omit<Notification, 'id' | 'createdAt'>,
): Promise<Notification> {
  const row = await db
    .prepare(
      `INSERT INTO notifications (user_id, email_id, from_address, subject, message, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       RETURNING *`,
    )
    .bind(
      notification.userId,
      notification.emailId,
      notification.fromAddress,
      notification.subject,
      notification.message,
      notification.sentAt,
    )
    .first<NotificationRow>();

  if (!row) throw new Error('Failed to create notification');
  return mapNotification(row);
}

export async function getNotificationsByUser(
  db: D1Database,
  userId: number,
  limit: number,
): Promise<Notification[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, email_id, from_address, subject, message, sent_at, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY sent_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<NotificationRow>();
  return results.map(mapNotification);
}
