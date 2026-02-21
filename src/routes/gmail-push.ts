import { Hono } from 'hono'
import type { Env } from '../index'
import { parsePubSubMessage } from '../gmail/push'
import { GmailClient } from '../gmail/client'
import { getActiveUsers, updateGmailHistoryId } from '../db'

export const gmailPushRoutes = new Hono<{ Bindings: Env }>()

gmailPushRoutes.post('/push', async (c) => {
  // Verify this is from our Pub/Sub subscription
  const token = c.req.query('token')
  if (token !== c.env.PUBSUB_VERIFICATION_TOKEN) {
    return c.text('Unauthorized', 401)
  }

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.text('Invalid JSON', 400)
  }

  try {
    const notification = parsePubSubMessage(body as Parameters<typeof parsePubSubMessage>[0])
    const users = await getActiveUsers(c.env.DB)
    const user = users.find(u => u.email === notification.emailAddress)
    if (!user) return c.text('OK', 200)

    // Use Gmail History API to get message IDs added since last check
    const client = new GmailClient(user.access_token)
    const messages = await client.getMessagesSince(user.gmail_history_id ?? '0')

    // Update stored history ID immediately
    await updateGmailHistoryId(c.env.DB, user.id, String(notification.historyId))

    // Enqueue each new message for background processing
    if (messages.length > 0) {
      await c.env.EMAIL_QUEUE.sendBatch(
        messages.map(msg => ({ body: { userId: user.id, messageId: msg.id } }))
      )
      console.log(`Enqueued ${messages.length} message(s) for ${user.email}`)
    }
  } catch (e) {
    console.error('Push notification error:', e)
    // Still return 200 — returning non-200 causes Pub/Sub to retry
  }

  return c.text('OK', 200)
})
