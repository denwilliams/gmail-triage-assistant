import type { Env } from '../../types/env';
import { processTransactional } from '../../services/ai';
import { runBucketProcessor, type BucketProcessor } from './shared';

function sanitiseVendor(vendor: string): string {
  // Keep this strict — vendors will become label names.
  return vendor.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const processor: BucketProcessor = async (ctx) => {
  const result = await processTransactional(ctx.env, {
    from: ctx.gmailMsg.from,
    subject: ctx.gmailMsg.subject,
    body: ctx.gmailMsg.body,
    senderContext: ctx.senderContext,
    userSystemPrompt: ctx.userSystemPrompt,
  });

  // Build the vendor label.
  const labels = [...result.labels];
  const vendorSlug = sanitiseVendor(result.vendor);
  if (vendorSlug && !labels.some((l) => l === `transactional/${vendorSlug}`)) {
    labels.unshift(`transactional/${vendorSlug}`);
  } else if (!labels.some((l) => l.startsWith('transactional'))) {
    labels.unshift('transactional');
  }

  // Force a timed label when the AI didn't pick one.
  const hasTimedLabel = labels.some((l) => l.startsWith('📥/') || l.startsWith('🗑️/'));
  if (!hasTimedLabel) {
    labels.push('🗑️/1m');
  }

  const amountPart = result.amount ? ` ${result.amount}` : '';
  const reasoning = `Transactional ${result.document_type}${amountPart} from ${result.vendor || 'unknown'}. ${result.reasoning}`;

  return {
    slug: result.slug,
    summary: result.summary,
    keywords: result.keywords,
    labels,
    bypassInbox: true,
    notificationMessage: '',
    draftBody: '',
    reasoning,
  };
};

export async function processTransactionalMessage(
  env: Env,
  userId: number,
  messageId: string,
): Promise<void> {
  await runBucketProcessor(env, 'transactional', userId, messageId, processor);
}
