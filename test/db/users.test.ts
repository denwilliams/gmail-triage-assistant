import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { getUser, getUserByGoogleId, createUser, updateUserToken } from '../../src/db/users'
import { applySchema } from '../setup'

describe('users db', () => {
  beforeEach(async () => {
    await applySchema(env.DB)
  })

  it('creates and retrieves a user', async () => {
    const user = await createUser(env.DB, {
      email: 'test@example.com',
      google_id: 'gid_123',
      access_token: 'acc',
      refresh_token: 'ref',
      token_expiry: new Date().toISOString(),
    })
    expect(user.email).toBe('test@example.com')

    const found = await getUserByGoogleId(env.DB, 'gid_123')
    expect(found?.id).toBe(user.id)
  })

  it('getUser returns null for non-existent user', async () => {
    const user = await getUser(env.DB, 99999)
    expect(user).toBeNull()
  })
})
