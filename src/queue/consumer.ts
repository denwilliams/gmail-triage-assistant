import type { Env, EmailQueueMessage } from '../index'
import { getUser } from '../db'
import { processEmail } from '../pipeline/processor'

export async function handleEmailQueue(
  batch: MessageBatch<EmailQueueMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { userId, messageId } = message.body
    try {
      const user = await getUser(env.DB, userId)
      if (!user) {
        console.warn(`User ${userId} not found for message ${messageId}, acking`)
        message.ack()
        continue
      }

      await processEmail(env, user, messageId)
      message.ack()
      console.log(`✓ Processed message ${messageId} for user ${user.email}`)
    } catch (e) {
      console.error(`Failed to process message ${messageId}:`, e)
      message.retry()
    }
  }
}
