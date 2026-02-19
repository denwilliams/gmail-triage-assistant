import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'
import { createSession, getSession, deleteSession } from '../../src/auth/session'

describe('session', () => {
  it('creates and retrieves a session', async () => {
    const token = await createSession(env.SESSIONS, { userId: 42, email: 'me@example.com' })
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
    const session = await getSession(env.SESSIONS, token)
    expect(session?.userId).toBe(42)
    expect(session?.email).toBe('me@example.com')
  })

  it('returns null for unknown token', async () => {
    const session = await getSession(env.SESSIONS, 'not-a-real-token')
    expect(session).toBeNull()
  })

  it('deletes a session', async () => {
    const token = await createSession(env.SESSIONS, { userId: 1, email: 'a@b.com' })
    await deleteSession(env.SESSIONS, token)
    const session = await getSession(env.SESSIONS, token)
    expect(session).toBeNull()
  })
})
