import { Hono } from 'hono'
import type { Env } from '../index'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import * as db from '../db'
import { wrapupsPage } from '../templates/wrapups'

export const wrapupsRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

wrapupsRoutes.use('*', requireAuth)

wrapupsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const reports = await db.getWrapupReports(c.env.DB, user.id)
  return c.html(wrapupsPage(user.email, reports))
})
