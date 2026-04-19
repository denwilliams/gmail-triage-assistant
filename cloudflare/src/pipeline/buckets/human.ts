import type { Env } from '../../types/env';
import { generateDraftReply } from '../../services/openai';
import { aiConfig, processHuman } from '../../services/ai';
import { getUserLabelsWithDetails } from '../../db/labels';
import { runBucketProcessor, type BucketProcessor } from './shared';

const HUMAN_RATING_THRESHOLD = 40;

// Timed labels the AI can apply to keep archived emails from accumulating.
const TIMED_LABELS = [
  '📥/1d', '📥/1w', '📥/1m', '📥/1y', '📥/read',
  '🗑️/1d', '🗑️/1w', '🗑️/1m', '🗑️/1y',
];

const TIMED_LABELS_HELP = `
--- Timed Action Labels (system) ---
- "📥/1d": Archive after 1 day (use for time-sensitive items briefly in inbox)
- "📥/1w": Archive after 1 week
- "📥/1m": Archive after 1 month
- "📥/1y": Archive after 1 year
- "📥/read": Archive after the user reads it
- "🗑️/1d": Delete after 1 day (OTP codes, shipping after delivery)
- "🗑️/1w" / "🗑️/1m" / "🗑️/1y": Delete after the given period`;

const processor: BucketProcessor = async (ctx) => {
  const labelDetails = await getUserLabelsWithDetails(ctx.env.DB, ctx.user.id);
  const labelNames: string[] = [];
  const labelLines: string[] = [];
  for (const l of labelDetails) {
    labelNames.push(l.name);
    let line = `- "${l.name}"`;
    if (l.description) line += `: ${l.description}`;
    if (l.reasons.length > 0) line += ` (e.g. ${l.reasons.join(', ')})`;
    labelLines.push(line);
  }
  labelNames.push(...TIMED_LABELS);

  const labelsFormatted = labelLines.join('\n') + TIMED_LABELS_HELP;

  const rating = ctx.senderProfile?.rating ?? null;
  const belowThreshold = rating !== null && rating < HUMAN_RATING_THRESHOLD;

  const result = await processHuman(ctx.env, {
    from: ctx.gmailMsg.from,
    subject: ctx.gmailMsg.subject,
    body: ctx.gmailMsg.body,
    labelsFormatted,
    labelNames,
    senderContext: ctx.senderContext,
    memoryContext: ctx.memoryContext,
    senderRating: rating,
    userSystemPrompt: ctx.userSystemPrompt,
  });

  // Rating gate: if we have a confident low rating, archive regardless of
  // what the AI wanted to do with it. The email still appears in the daily
  // digest so the user can review.
  const bypassInbox = belowThreshold;
  const labels = belowThreshold && !result.labels.some((l) => l.startsWith('🗑️') || l.startsWith('📥'))
    ? [...result.labels, '📥/1w']
    : result.labels;

  // Generate a draft reply if the AI asked for one AND the sender isn't
  // rating-gated (we don't want to draft replies to low-priority senders).
  let draftBody = '';
  if (result.draft_reply && !belowThreshold) {
    try {
      draftBody = await generateDraftReply(
        aiConfig(ctx.env, 'human'),
        ctx.gmailMsg.from,
        ctx.gmailMsg.subject,
        ctx.gmailMsg.body,
        ctx.senderContext,
        ctx.userSystemPrompt,
      );
    } catch (err) {
      console.error(`human bucket: draft generation failed:`, err);
    }
  }

  const ratingNote = rating !== null
    ? ` (sender rating ${rating}${belowThreshold ? ', below threshold' : ''})`
    : '';

  return {
    slug: result.slug,
    summary: result.summary,
    keywords: result.keywords,
    labels,
    bypassInbox,
    notificationMessage: belowThreshold ? '' : result.notification_message,
    draftBody,
    reasoning: `Human${ratingNote}. ${result.reasoning}`,
  };
};

export async function processHumanMessage(
  env: Env,
  userId: number,
  messageId: string,
): Promise<void> {
  await runBucketProcessor(env, 'human', userId, messageId, processor);
}
