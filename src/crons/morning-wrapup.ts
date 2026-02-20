import type { Env } from '../index'
import { getActiveUsers } from '../db'
import { generateMorningWrapup } from '../wrapup/service'

export async function runMorningWrapup(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      await generateMorningWrapup(env, user.id)
    } catch (e) {
      console.error(`Morning wrapup failed for ${user.email}:`, e)
    }
  }
}
