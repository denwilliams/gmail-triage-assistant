import type { Context } from 'hono';
import type { Env } from '../types/env';
import {
  getUserByID,
  setUserActive,
  setUserPipelineVersion,
  updatePushoverConfig,
  updateV2Settings,
  updateWebhookConfig,
} from '../db/users';
import type { Bucket, PipelineVersion } from '../types/models';
import { BUCKETS } from '../types/models';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function maskValue(value: string): string {
  if (!value) return '';
  if (value.length > 4) {
    return '****' + value.slice(-4);
  }
  return '****';
}

export async function handleGetSettings(c: AppContext) {
  const userId = c.get('userId');

  try {
    const user = await getUserByID(c.env.DB, userId);
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const pushoverConfigured = !!(user.pushoverUserKey && user.pushoverAppToken);
    const webhookConfigured = !!(user.webhookUrl && user.webhookHeaderKey && user.webhookHeaderValue);

    return c.json({
      processing_enabled: user.isActive,
      pipeline_version: user.pipelineVersion,
      pushover_user_key: maskValue(user.pushoverUserKey),
      pushover_configured: pushoverConfigured,
      webhook_url: user.webhookUrl,
      webhook_header_key: user.webhookHeaderKey,
      webhook_header_value: maskValue(user.webhookHeaderValue),
      webhook_configured: webhookConfigured,
      v2_newsletter_threshold: user.v2NewsletterThreshold,
      v2_human_rating_threshold: user.v2HumanRatingThreshold,
      v2_calendar_imminent_minutes: user.v2CalendarImminentMinutes,
      v2_notify_buckets: user.v2NotifyBuckets,
      user_identity: user.userIdentity,
    });
  } catch (e) {
    console.error('Failed to load settings:', e);
    return c.json({ error: 'Failed to load settings' }, 500);
  }
}

export async function handleUpdatePushover(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req.json<{ user_key?: string; app_token?: string }>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  try {
    await updatePushoverConfig(c.env.DB, userId, body.user_key ?? '', body.app_token ?? '');
    return c.json({ status: 'updated' });
  } catch (e) {
    console.error('Failed to update pushover config:', e);
    return c.json({ error: 'Failed to save Pushover settings' }, 500);
  }
}

export async function handleUpdateProcessing(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req.json<{ enabled?: boolean }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json({ error: 'Invalid JSON: expected { enabled: boolean }' }, 400);
  }

  try {
    await setUserActive(c.env.DB, userId, body.enabled);
    return c.json({ status: 'updated', processing_enabled: body.enabled });
  } catch (e) {
    console.error('Failed to update processing setting:', e);
    return c.json({ error: 'Failed to save processing setting' }, 500);
  }
}

export async function handleUpdatePipelineVersion(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req.json<{ version?: string }>().catch(() => null);
  if (!body || (body.version !== 'v1' && body.version !== 'v2')) {
    return c.json({ error: 'Invalid JSON: expected { version: "v1" | "v2" }' }, 400);
  }

  try {
    await setUserPipelineVersion(c.env.DB, userId, body.version as PipelineVersion);
    return c.json({ status: 'updated', pipeline_version: body.version });
  } catch (e) {
    console.error('Failed to update pipeline version:', e);
    return c.json({ error: 'Failed to save pipeline version' }, 500);
  }
}

interface V2SettingsBody {
  newsletter_threshold?: number;
  human_rating_threshold?: number;
  calendar_imminent_minutes?: number;
  notify_buckets?: Record<string, boolean>;
  user_identity?: string;
}

const USER_IDENTITY_MAX_LEN = 4000;

export async function handleUpdateV2Settings(c: AppContext) {
  const userId = c.get('userId');
  const body = await c.req.json<V2SettingsBody>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const update: Parameters<typeof updateV2Settings>[2] = {};

  if (body.newsletter_threshold !== undefined) {
    const v = Math.round(Number(body.newsletter_threshold));
    if (!Number.isInteger(v) || v < 0 || v > 10) {
      return c.json({ error: 'newsletter_threshold must be 0..10' }, 400);
    }
    update.newsletterThreshold = v;
  }

  if (body.human_rating_threshold !== undefined) {
    const v = Math.round(Number(body.human_rating_threshold));
    if (!Number.isInteger(v) || v < 0 || v > 99) {
      return c.json({ error: 'human_rating_threshold must be 0..99' }, 400);
    }
    update.humanRatingThreshold = v;
  }

  if (body.calendar_imminent_minutes !== undefined) {
    const v = Math.round(Number(body.calendar_imminent_minutes));
    if (!Number.isInteger(v) || v < 0 || v > 1440) {
      return c.json({ error: 'calendar_imminent_minutes must be 0..1440' }, 400);
    }
    update.calendarImminentMinutes = v;
  }

  if (body.notify_buckets !== undefined) {
    if (!body.notify_buckets || typeof body.notify_buckets !== 'object') {
      return c.json({ error: 'notify_buckets must be an object' }, 400);
    }
    const cleaned: Partial<Record<Bucket, boolean>> = {};
    for (const [key, val] of Object.entries(body.notify_buckets)) {
      if (!BUCKETS.includes(key as Bucket)) {
        return c.json({ error: `unknown bucket: ${key}` }, 400);
      }
      if (typeof val !== 'boolean') {
        return c.json({ error: `notify_buckets.${key} must be boolean` }, 400);
      }
      cleaned[key as Bucket] = val;
    }
    update.notifyBuckets = cleaned;
  }

  if (body.user_identity !== undefined) {
    if (typeof body.user_identity !== 'string') {
      return c.json({ error: 'user_identity must be a string' }, 400);
    }
    if (body.user_identity.length > USER_IDENTITY_MAX_LEN) {
      return c.json({ error: `user_identity must be <= ${USER_IDENTITY_MAX_LEN} characters` }, 400);
    }
    update.userIdentity = body.user_identity;
  }

  try {
    await updateV2Settings(c.env.DB, userId, update);
    const user = await getUserByID(c.env.DB, userId);
    if (!user) return c.json({ error: 'User not found' }, 404);
    return c.json({
      status: 'updated',
      v2_newsletter_threshold: user.v2NewsletterThreshold,
      v2_human_rating_threshold: user.v2HumanRatingThreshold,
      v2_calendar_imminent_minutes: user.v2CalendarImminentMinutes,
      v2_notify_buckets: user.v2NotifyBuckets,
      user_identity: user.userIdentity,
    });
  } catch (e) {
    console.error('Failed to update v2 settings:', e);
    return c.json({ error: 'Failed to save v2 settings' }, 500);
  }
}

export async function handleUpdateWebhook(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req.json<{ url?: string; header_key?: string; header_value?: string }>().catch(
    () => null,
  );
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  try {
    await updateWebhookConfig(
      c.env.DB,
      userId,
      body.url ?? '',
      body.header_key ?? '',
      body.header_value ?? '',
    );
    return c.json({ status: 'updated' });
  } catch (e) {
    console.error('Failed to update webhook config:', e);
    return c.json({ error: 'Failed to save webhook settings' }, 500);
  }
}
