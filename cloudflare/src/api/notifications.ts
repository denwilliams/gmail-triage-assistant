import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Notification } from '../types/models';
import { getNotificationsByUser } from '../db/notifications';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function notificationToJSON(n: Notification) {
  return {
    id: n.id,
    user_id: n.userId,
    email_id: n.emailId,
    from_address: n.fromAddress,
    subject: n.subject,
    message: n.message,
    sent_at: n.sentAt,
    created_at: n.createdAt,
  };
}

export async function handleGetNotifications(c: AppContext) {
  const userId = c.get('userId');
  let limit = 50;
  const lParam = c.req.query('limit');
  if (lParam) {
    const parsed = parseInt(lParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  try {
    const notifications = await getNotificationsByUser(c.env.DB, userId, limit);
    return c.json(notifications.map(notificationToJSON));
  } catch (e) {
    console.error('Failed to load notifications:', e);
    return c.json({ error: 'Failed to load notifications' }, 500);
  }
}
