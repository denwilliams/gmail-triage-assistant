import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { RecentEmailFilters } from '../db/emails';
import { getRecentEmails, updateEmailFeedback } from '../db/emails';
import type { Bucket, Email, PipelineStage, TriageVia } from '../types/models';
import { BUCKETS } from '../types/models';

const PIPELINE_STAGES: PipelineStage[] = ['queued', 'bucketed', 'processed', 'failed'];
const TRIAGE_VIAS: TriageVia[] = ['ai', 'thread_reply', 'consistent_sender'];

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
    bucket: e.bucket,
    pipeline_stage: e.pipelineStage,
    triage_via: e.triageVia,
    triage_reasoning: e.triageReasoning,
    severity: e.severity,
    urgency: e.urgency,
    interesting_score: e.interestingScore,
    interesting_reasons: e.interestingReasons,
    in_reply_to: e.inReplyTo,
    thread_id: e.threadId,
    included_in_digest: e.includedInDigest,
    vendor: e.vendor,
    document_type: e.documentType,
    amount: e.amount,
    action_type: e.actionType,
    is_otp: e.isOtp,
    event_title: e.eventTitle,
    event_starts_at: e.eventStartsAt,
    event_ends_at: e.eventEndsAt,
    event_location: e.eventLocation,
    event_attendees: e.eventAttendees,
  };
}

export async function handleGetEmails(c: AppContext) {
  const userId = c.get('userId');
  let limit = 50;
  let offset = 0;
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

  const filters: RecentEmailFilters = {};

  const bParam = c.req.query('bucket');
  if (bParam) {
    if (!BUCKETS.includes(bParam as Bucket)) {
      return c.json({ error: 'Invalid bucket' }, 400);
    }
    filters.bucket = bParam as Bucket;
  }

  const sParam = c.req.query('pipeline_stage');
  if (sParam) {
    if (!PIPELINE_STAGES.includes(sParam as PipelineStage)) {
      return c.json({ error: 'Invalid pipeline_stage' }, 400);
    }
    filters.pipelineStage = sParam as PipelineStage;
  }

  const vParam = c.req.query('triage_via');
  if (vParam) {
    if (!TRIAGE_VIAS.includes(vParam as TriageVia)) {
      return c.json({ error: 'Invalid triage_via' }, 400);
    }
    filters.triageVia = vParam as TriageVia;
  }

  if (c.req.query('v2_only') === '1') {
    filters.v2Only = true;
  }

  try {
    const emails = await getRecentEmails(c.env.DB, userId, limit, offset, filters);
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
