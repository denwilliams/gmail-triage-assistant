import type { Env } from '../../types/env';
import { processNotification } from '../../services/ai';
import { runBucketProcessor, type BucketProcessor } from './shared';

// Archive label for low/medium notifications — short-lived by default.
const LOW_PRIORITY_TIMED_LABEL = '🗑️/1w';

function isHighPriority(severity: string, urgency: string): boolean {
  return severity === 'high' || severity === 'critical' || urgency === 'high';
}

const processor: BucketProcessor = async (ctx) => {
  const result = await processNotification(ctx.env, {
    from: ctx.gmailMsg.from,
    subject: ctx.gmailMsg.subject,
    body: ctx.gmailMsg.body,
    senderContext: ctx.senderContext,
    memoryContext: ctx.memoryContext,
    userSystemPrompt: ctx.userSystemPrompt,
  });

  const highPriority = isHighPriority(result.severity, result.urgency);
  const labels = highPriority ? [] : [LOW_PRIORITY_TIMED_LABEL];

  return {
    slug: result.slug,
    summary: result.summary,
    keywords: result.keywords,
    labels,
    bypassInbox: !highPriority,
    notificationMessage: highPriority ? result.notification_message : '',
    draftBody: '',
    severity: result.severity,
    urgency: result.urgency,
    reasoning: `Notification (severity=${result.severity}, urgency=${result.urgency}). ${result.reasoning}`,
  };
};

export async function processNotificationMessage(
  env: Env,
  userId: number,
  messageId: string,
): Promise<void> {
  await runBucketProcessor(env, 'notification', userId, messageId, processor);
}
