import type { Env } from '../index'
import { getActiveUsers, updateGmailHistoryId } from '../db'
import { GmailClient } from '../gmail/client'

export async function renewGmailWatch(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB)
  for (const user of users) {
    try {
      const client = new GmailClient(user.access_token)
      const watch = await client.watchInbox(env.PUBSUB_TOPIC)
      await updateGmailHistoryId(env.DB, user.id, watch.historyId)
      console.log(`✓ Gmail watch renewed for ${user.email}`)
    } catch (e) {
      console.error(`Watch renewal failed for ${user.email}:`, e)
    }
  }
}
