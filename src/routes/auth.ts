import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../index'
import { buildAuthUrl, exchangeCode, getUserInfo } from '../auth/google'
import { createSession, deleteSession } from '../auth/session'
import * as db from '../db'

export const authRoutes = new Hono<{ Bindings: Env }>()

authRoutes.get('/login', (c) => {
  const url = buildAuthUrl(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_REDIRECT_URL)
  return c.redirect(url, 302)
})

authRoutes.get('/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.text('No code', 400)

  const tokens = await exchangeCode(
    code, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET, c.env.GOOGLE_REDIRECT_URL
  )
  const userInfo = await getUserInfo(tokens.access_token)
  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  let user = await db.getUserByGoogleId(c.env.DB, userInfo.id)
  if (!user) {
    user = await db.createUser(c.env.DB, {
      email: userInfo.email,
      google_id: userInfo.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? '',
      token_expiry: tokenExpiry,
    })
    await db.initDefaultPrompts(c.env.DB, user.id)
  } else {
    await db.updateUserToken(c.env.DB, user.id, tokens.access_token, tokens.refresh_token ?? user.refresh_token, tokenExpiry)
    user = (await db.getUser(c.env.DB, user.id))!
  }

  // Register Gmail watch for push notifications
  try {
    const { GmailClient } = await import('../gmail/client')
    const gmailClient = new GmailClient(tokens.access_token)
    const watch = await gmailClient.watchInbox(c.env.PUBSUB_TOPIC)
    await db.updateGmailHistoryId(c.env.DB, user.id, watch.historyId)
  } catch (e) {
    console.error('Failed to register Gmail watch:', e)
  }

  const token = await createSession(c.env.SESSIONS, { userId: user.id, email: user.email })
  setCookie(c, 'session', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  return c.redirect('/dashboard', 302)
})

authRoutes.get('/logout', async (c) => {
  const token = getCookie(c, 'session')
  if (token) await deleteSession(c.env.SESSIONS, token)
  deleteCookie(c, 'session')
  return c.redirect('/', 302)
})
