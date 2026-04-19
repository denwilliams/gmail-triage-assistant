import type { Context } from 'hono';
import type { Env } from '../types/env';
import {
  getUserByID,
  setUserActive,
  setUserPipelineVersion,
  updatePushoverConfig,
  updateWebhookConfig,
} from '../db/users';
import type { PipelineVersion } from '../types/models';

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
