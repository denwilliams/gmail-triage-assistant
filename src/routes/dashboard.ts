import { Hono } from 'hono'
import type { Env } from '../index'
import type { User } from '../types'
import { requireAuth, type AuthVariables } from '../middleware/auth'
import { dashboardPage } from '../templates/dashboard'

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>()

dashboardRoutes.use('*', requireAuth)

dashboardRoutes.get('/', async (c) => {
  const user = c.get('user')
  return c.html(dashboardPage(user.email))
})
