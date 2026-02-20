import type { Env } from '../index'
import { getActiveUsers } from '../db'
import { generateYearlyMemory } from '../memory/service'

export async function runYearlyMemory(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      await generateYearlyMemory(env, user.id)
    } catch (e) {
      console.error(`Yearly memory failed for ${user.email}:`, e)
    }
  }
}
