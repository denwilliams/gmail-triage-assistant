import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Bucket, PipelineStage } from '../types/models';
import { BUCKETS } from '../types/models';
import { getEmailByID, resetEmailForRetry } from '../db/emails';
import { getPipelineOps, type PipelineOps, type StuckEmail } from '../db/stats';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

const PIPELINE_STAGES: readonly string[] = ['triage', ...BUCKETS, 'summary', 'sender_rating'];

interface StageModelRow {
  stage: string;                // triage | newsletter | ... | summary | sender_rating
  configured_model: string | null;  // explicit OPENAI_MODEL_<STAGE> value, or null
  effective_model: string;          // configured || default
}

function getPerStageModels(env: Env): StageModelRow[] {
  const def = env.OPENAI_MODEL || '';
  const pick = (key: keyof Env): string | null => {
    const v = env[key];
    return typeof v === 'string' && v ? v : null;
  };

  const map: Record<string, string | null> = {
    triage: pick('OPENAI_MODEL_TRIAGE'),
    newsletter: pick('OPENAI_MODEL_NEWSLETTER'),
    notification: pick('OPENAI_MODEL_NOTIFICATION'),
    human: pick('OPENAI_MODEL_HUMAN'),
    transactional: pick('OPENAI_MODEL_TRANSACTIONAL'),
    security: pick('OPENAI_MODEL_SECURITY'),
    calendar: pick('OPENAI_MODEL_CALENDAR'),
    summary: pick('OPENAI_MODEL_SUMMARY'),
    sender_rating: pick('OPENAI_MODEL_SENDER_RATING'),
  };

  return PIPELINE_STAGES.map((stage) => ({
    stage,
    configured_model: map[stage] ?? null,
    effective_model: map[stage] ?? def,
  }));
}

export async function handleGetPipelineConfig(c: AppContext) {
  try {
    return c.json({
      default_model: c.env.OPENAI_MODEL || '',
      openai_base_url: c.env.OPENAI_BASE_URL || '',
      stages: getPerStageModels(c.env),
    });
  } catch (e) {
    console.error('Failed to load pipeline config:', e);
    return c.json({ error: 'Failed to load pipeline config' }, 500);
  }
}

function opsEmailToJSON(e: StuckEmail) {
  return {
    id: e.id,
    from_address: e.fromAddress,
    subject: e.subject,
    bucket: e.bucket,
    pipeline_stage: e.pipelineStage,
    triage_via: e.triageVia,
    processed_at: e.processedAt,
    created_at: e.createdAt,
    reasoning: e.reasoning,
  };
}

function opsToJSON(o: PipelineOps) {
  return {
    stuck: o.stuck.map(opsEmailToJSON),
    failed: o.failed.map(opsEmailToJSON),
    daily_throughput: o.dailyThroughput,
  };
}

export async function handleGetPipelineOps(c: AppContext) {
  const userId = c.get('userId');
  try {
    const ops = await getPipelineOps(c.env.DB, userId);
    return c.json(opsToJSON(ops));
  } catch (e) {
    console.error('Failed to load pipeline ops:', e);
    return c.json({ error: 'Failed to load pipeline ops' }, 500);
  }
}

/** Re-enqueue a failed or stuck email onto the appropriate queue. For
 *  'queued' emails (triage hasn't started or finished) we can't safely
 *  re-run triage — the email row already exists and triage dedups. We
 *  re-enqueue onto the bucket queue if we have a bucket, otherwise error. */
export async function handlePipelineRetry(c: AppContext) {
  const userId = c.get('userId');
  const emailId = c.req.param('id') ?? '';
  if (!emailId) {
    return c.json({ error: 'Missing email ID' }, 400);
  }

  try {
    const email = await getEmailByID(c.env.DB, emailId);
    if (!email || email.userId !== userId) {
      return c.json({ error: 'Email not found' }, 404);
    }
    if (email.pipelineStage === 'processed') {
      return c.json({ error: 'Email already processed' }, 400);
    }
    if (!email.bucket) {
      return c.json(
        { error: 'Cannot retry: email has no bucket — triage never completed' },
        400,
      );
    }

    // Mark the row as bucketed again so the processor's skip check passes
    // (it skips `processed`).
    await resetEmailForRetry(c.env.DB, emailId, 'bucketed' as PipelineStage);

    // Re-enqueue onto the matching bucket queue.
    const queueByBucket: Record<Bucket, Queue> = {
      newsletter: c.env.BUCKET_NEWSLETTER_QUEUE,
      notification: c.env.BUCKET_NOTIFICATION_QUEUE,
      human: c.env.BUCKET_HUMAN_QUEUE,
      transactional: c.env.BUCKET_TRANSACTIONAL_QUEUE,
      security: c.env.BUCKET_SECURITY_QUEUE,
      calendar: c.env.BUCKET_CALENDAR_QUEUE,
    };
    const queue = queueByBucket[email.bucket];
    await queue.send({ userId, messageId: emailId, bucket: email.bucket });

    return c.json({ status: 'requeued', bucket: email.bucket });
  } catch (e) {
    console.error('Failed to retry email:', e);
    return c.json({ error: 'Failed to retry email' }, 500);
  }
}
