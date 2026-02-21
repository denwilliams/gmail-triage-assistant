import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { authRoutes } from './routes/auth'
import { dashboardRoutes } from './routes/dashboard'
import { labelsRoutes } from './routes/labels'
import { historyRoutes } from './routes/history'
import { promptsRoutes } from './routes/prompts'
import { memoriesRoutes } from './routes/memories'
import { wrapupsRoutes } from './routes/wrapups'
import { gmailPushRoutes } from './routes/gmail-push'
import { handleEmailQueue } from './queue/consumer'
import { handleScheduled } from './crons'
import { getSession } from './auth/session'
import { homePage } from './templates/home'

export type EmailQueueMessage = {
  userId: number
  messageId: string
}

export type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  EMAIL_QUEUE: Queue<EmailQueueMessage>
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REDIRECT_URL: string
  OPENAI_API_KEY: string
  OPENAI_MODEL: string
  SESSION_SECRET: string
  PUBSUB_TOPIC: string
  PUBSUB_VERIFICATION_TOKEN: string
}

const app = new Hono<{ Bindings: Env }>()

app.get('/', async (c) => {
  const token = getCookie(c, 'session')
  if (token) {
    const session = await getSession(c.env.SESSIONS, token)
    if (session) return c.redirect('/dashboard', 302)
  }
  return c.html(homePage())
})

app.route('/auth', authRoutes)
app.route('/dashboard', dashboardRoutes)
app.route('/labels', labelsRoutes)
app.route('/history', historyRoutes)
app.route('/prompts', promptsRoutes)
app.route('/memories', memoriesRoutes)
app.route('/wrapups', wrapupsRoutes)
app.route('/api/gmail', gmailPushRoutes)

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(event, env))
  },
  async queue(batch: MessageBatch<EmailQueueMessage>, env: Env) {
    await handleEmailQueue(batch, env)
  },
}
