import type { Env } from '../../types/env';
import { processSecurity } from '../../services/ai';
import { runBucketProcessor, type BucketProcessor } from './shared';

const processor: BucketProcessor = async (ctx) => {
  const result = await processSecurity(ctx.env, {
    from: ctx.gmailMsg.from,
    subject: ctx.gmailMsg.subject,
    body: ctx.gmailMsg.body,
    senderContext: ctx.senderContext,
    userSystemPrompt: ctx.userSystemPrompt,
  });

  const labels = ['security'];
  // OTPs are short-lived by nature — auto-delete after a day so they don't
  // pile up in the inbox.
  if (result.is_otp) {
    labels.push('🗑️/1d');
  }

  return {
    slug: result.slug,
    summary: result.summary,
    keywords: result.keywords,
    labels,
    // Security emails stay in the inbox — this is the fast lane.
    bypassInbox: false,
    notificationMessage: result.notification_message,
    draftBody: '',
    reasoning: `Security (${result.action_type}${result.is_otp ? ', OTP' : ''}). ${result.reasoning}`,
  };
};

export async function processSecurityMessage(
  env: Env,
  userId: number,
  messageId: string,
): Promise<void> {
  await runBucketProcessor(env, 'security', userId, messageId, processor);
}
