import type { Env } from '../index'
import { runMorningWrapup } from './morning-wrapup'
import { runEveningTasks } from './evening'
import { runWeeklyMemory } from './weekly-memory'
import { runMonthlyMemory } from './monthly-memory'
import { runYearlyMemory } from './yearly-memory'
import { renewGmailWatch } from './renew-watch'

export async function handleScheduled(event: ScheduledEvent, env: Env): Promise<void> {
  const cron = event.cron
  console.log(`Cron triggered: ${cron}`)

  switch (cron) {
    case '0 8 * * *':   return runMorningWrapup(env)
    case '0 17 * * *':  return runEveningTasks(env)
    case '0 18 * * 6':  return runWeeklyMemory(env)
    case '0 19 1 * *':  return runMonthlyMemory(env)
    case '0 20 1 1 *':  return runYearlyMemory(env)
    case '0 9 * * *':   return renewGmailWatch(env)
    default:
      console.warn(`Unknown cron: ${cron}`)
      return
  }
}
