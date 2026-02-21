import type { Env } from '../index'
import { getActiveUsers } from '../db'
import { generateWeeklyMemory } from '../memory/service'

export async function runWeeklyMemory(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      await generateWeeklyMemory(env, user.id)
    } catch (e) {
      console.error(`Weekly memory failed for ${user.email}:`, e)
    }
  }
}
