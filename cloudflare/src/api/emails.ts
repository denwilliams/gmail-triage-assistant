import type { Context } from 'hono';
import type { Env } from '../types/env';
import { getRecentEmails, getRecentEmailsByBucket, updateEmailFeedback } from '../db/emails';
import type { Email, Bucket } from '../types/models';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function emailToJSON(e: Email) {
  return {
    id: e.id,
    user_id: e.userId,
    from_address: e.fromAddress,
    subject: e.subject,
    slug: e.slug,
    keywords: e.keywords,
    summary: e.summary,
    labels_applied: e.labelsApplied,
    bypassed_inbox: e.bypassedInbox,
    notification_sent: e.notificationSent,
    draft_created: e.draftCreated,
    reasoning: e.reasoning,
    human_feedback: e.humanFeedback,
    feedback_dirty: e.feedbackDirty,
    processed_at: e.processedAt,
    created_at: e.createdAt,
    // v2 pipeline fields
    bucket: e.bucket,
    pipeline_stage: e.pipelineStage,
    triage_reasoning: e.triageReasoning,
    triage_via: e.triageVia,
    severity: e.severity,
    urgency: e.urgency,
    interesting_score: e.interestingScore,
    interesting_reasons: e.interestingReasons,
    in_reply_to: e.inReplyTo,
    thread_id: e.threadId,
    included_in_digest: e.includedInDigest,
  };
}

export async function handleGetEmails(c: AppContext) {
  const userId = c.get('userId');
  let limit = 50;
  let offset = 0;
  let bucket: Bucket | null = null;

  const lParam = c.req.query('limit');
  if (lParam) {
    const parsed = parseInt(lParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }
  const oParam = c.req.query('offset');
  if (oParam) {
    const parsed = parseInt(oParam, 10);
    if (!isNaN(parsed) && parsed >= 0) offset = parsed;
  }
  const bParam = c.req.query('bucket');
  if (bParam && bParam.length > 0) {
    bucket = bParam as Bucket;
  }

  try {
    const emails = bucket
      ? await getRecentEmailsByBucket(c.env.DB, userId, bucket, limit, offset)
      : await getRecentEmails(c.env.DB, userId, limit, offset);
    return c.json(emails.map(emailToJSON));
  } catch (e) {
    console.error('Failed to load emails:', e);
    return c.json({ error: 'Failed to load emails' }, 500);
  }
}

export async function handleUpdateFeedback(c: AppContext) {
  const userId = c.get('userId');
  const emailId = c.req.param('id') ?? '';
  if (!emailId) {
    return c.json({ error: 'Missing email ID' }, 400);
  }

  const body = await c.req.json<{ feedback?: string }>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  try {
    await updateEmailFeedback(c.env.DB, userId, emailId, body.feedback ?? '');
    return c.json({ status: 'updated' });
  } catch (e) {
    console.error('Failed to update feedback:', e);
    return c.json({ error: 'Failed to save feedback' }, 500);
  }
}
