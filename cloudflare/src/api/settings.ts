import type { Context } from 'hono';
import type { Env } from '../types/env';
import { getUserByID, updatePushoverConfig, updateWebhookConfig } from '../db/users';

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
