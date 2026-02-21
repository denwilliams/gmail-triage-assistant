import type { Env } from '../index'
import { getActiveUsers } from '../db'
import { generateMonthlyMemory } from '../memory/service'

export async function runMonthlyMemory(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      await generateMonthlyMemory(env, user.id)
    } catch (e) {
      console.error(`Monthly memory failed for ${user.email}:`, e)
    }
  }
}
