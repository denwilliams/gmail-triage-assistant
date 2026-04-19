import type { Env } from '../../types/env';
import { processNewsletter } from '../../services/ai';
import { runBucketProcessor, type BucketProcessor } from './shared';

const NEWSLETTER_TIMED_LABEL = '🗑️/1m';

const processor: BucketProcessor = async (ctx) => {
  const result = await processNewsletter(ctx.env, {
    from: ctx.gmailMsg.from,
    subject: ctx.gmailMsg.subject,
    body: ctx.gmailMsg.body,
    senderContext: ctx.senderContext,
    memoryContext: ctx.memoryContext,
    userSystemPrompt: ctx.userSystemPrompt,
  });

  return {
    slug: result.slug,
    summary: result.summary,
    keywords: result.keywords,
    labels: [NEWSLETTER_TIMED_LABEL],
    bypassInbox: true,
    notificationMessage: '',
    draftBody: '',
    interestingScore: result.interesting_score,
    interestingReasons: result.interesting_reasons,
    reasoning: `Newsletter (score ${result.interesting_score}/10). ${result.interesting_reasons.join('; ')}`,
  };
};

export async function processNewsletterMessage(
  env: Env,
  userId: number,
  messageId: string,
): Promise<void> {
  await runBucketProcessor(env, 'newsletter', userId, messageId, processor);
}
