import type { Env } from '../../types/env';
import { processCalendar } from '../../services/ai';
import { runBucketProcessor, type BucketProcessor } from './shared';

const IMMINENT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const processor: BucketProcessor = async (ctx) => {
  const result = await processCalendar(ctx.env, {
    from: ctx.gmailMsg.from,
    subject: ctx.gmailMsg.subject,
    body: ctx.gmailMsg.body,
    senderContext: ctx.senderContext,
    userSystemPrompt: ctx.userSystemPrompt,
  });

  const labels = ['calendar'];

  // Notify only when the event is imminent. The AI may have set its own
  // notification_message — honour it in that case too, since a
  // cancellation of an imminent event is still worth surfacing.
  let notificationMessage = result.notification_message;
  if (!notificationMessage && result.starts_at) {
    const startsMs = Date.parse(result.starts_at);
    if (!Number.isNaN(startsMs) && startsMs - Date.now() <= IMMINENT_WINDOW_MS && startsMs > Date.now()) {
      notificationMessage = `Starting soon: ${result.event_title}`;
    }
  }

  return {
    slug: result.slug,
    summary: result.summary,
    keywords: result.keywords,
    labels,
    // Calendar items stay in the inbox so the user can respond.
    bypassInbox: false,
    notificationMessage,
    draftBody: '',
    eventTitle: result.event_title || null,
    eventStartsAt: result.starts_at || null,
    eventEndsAt: result.ends_at || null,
    eventLocation: result.location || null,
    eventAttendees: result.attendees ?? [],
    reasoning: `Calendar: ${result.event_title || 'event'}${result.starts_at ? ' at ' + result.starts_at : ''}. ${result.reasoning}`,
  };
};

export async function processCalendarMessage(
  env: Env,
  userId: number,
  messageId: string,
): Promise<void> {
  await runBucketProcessor(env, 'calendar', userId, messageId, processor);
}
