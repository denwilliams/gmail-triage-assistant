import type { Env } from '../index'
import { getActiveUsers } from '../db'
import { generateEveningWrapup } from '../wrapup/service'
import { generateDailyMemory } from '../memory/service'

export async function runEveningTasks(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      await generateEveningWrapup(env, user.id)
    } catch (e) {
      console.error(`Evening wrapup failed for ${user.email}:`, e)
    }
    try {
      await generateDailyMemory(env, user.id)
    } catch (e) {
      console.error(`Daily memory failed for ${user.email}:`, e)
    }
  }
}
