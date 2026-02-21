import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import type { Env } from '../index'
import { getSession } from '../auth/session'
import { getUser } from '../db'
import type { User } from '../types'

export type AuthVariables = { user: User }

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: AuthVariables }>(
  async (c, next) => {
    const token = getCookie(c, 'session')
    if (!token) return c.redirect('/auth/login', 302)

    const session = await getSession(c.env.SESSIONS, token)
    if (!session) return c.redirect('/auth/login', 302)

    const user = await getUser(c.env.DB, session.userId)
    if (!user) return c.redirect('/auth/login', 302)

    c.set('user', user)
    await next()
  }
)
