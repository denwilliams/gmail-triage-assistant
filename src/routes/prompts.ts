import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import * as db from '../db'
import { promptsPage } from '../templates/prompts'
import type { PromptType } from '../types'

export const promptsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

promptsRoutes.use('*', requireAuth)

promptsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const prompts = await db.getAllSystemPrompts(c.env.DB, user.id)
  return c.html(promptsPage(user.email, prompts))
})

promptsRoutes.post('/update', async (c) => {
  const user = c.get('user')
  const body = await c.req.parseBody()
  const type = String(body.type ?? '') as PromptType
  const content = String(body.content ?? '').trim()
  if (!type || !content) return c.text('type and content required', 400)
  await db.upsertSystemPrompt(c.env.DB, user.id, type, content)
  return c.redirect('/prompts', 302)
})

promptsRoutes.get('/init', async (c) => {
  const user = c.get('user')
  await db.initDefaultPrompts(c.env.DB, user.id)
  return c.redirect('/prompts', 302)
})
