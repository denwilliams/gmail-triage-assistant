import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import * as db from '../db'
import { memoriesPage } from '../templates/memories'
import { generateDailyMemory } from '../memory/service'

export const memoriesRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

memoriesRoutes.use('*', requireAuth)

memoriesRoutes.get('/', async (c) => {
  const user = c.get('user')
  const memories = await db.getAllMemories(c.env.DB, user.id)
  return c.html(memoriesPage(user.email, memories))
})

memoriesRoutes.post('/generate', async (c) => {
  const user = c.get('user')
  await generateDailyMemory(c.env, user.id)
  return c.redirect('/memories', 302)
})
