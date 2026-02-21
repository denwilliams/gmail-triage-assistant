import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import * as db from '../db'
import { historyPage } from '../templates/history'

export const historyRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

historyRoutes.use('*', requireAuth)

historyRoutes.get('/', async (c) => {
  const user = c.get('user')
  const emails = await db.getRecentEmails(c.env.DB, user.id, 50)
  return c.html(historyPage(user.email, emails))
})

historyRoutes.post('/feedback', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const emailId = String(body.email_id ?? '').trim()
  const feedback = String(body.feedback ?? '').trim()
  if (!emailId) return c.text('email_id required', 400)
  await db.updateEmailFeedback(c.env.DB, user.id, emailId, feedback)
  return c.redirect('/history', 302)
})
