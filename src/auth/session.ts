import type { SessionData } from '../types'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export async function createSession(kv: KVNamespace, data: SessionData): Promise<string> {
  const token = generateToken()
  await kv.put(`session:${token}`, JSON.stringify(data), { expirationTtl: SESSION_TTL_SECONDS })
  return token
}

export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null> {
  const raw = await kv.get(`session:${token}`)
  if (!raw) return null
  return JSON.parse(raw) as SessionData
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(`session:${token}`)
}
