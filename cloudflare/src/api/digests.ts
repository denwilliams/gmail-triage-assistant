import type { Context } from 'hono';
import type { Env } from '../types/env';
import { getDigestByDate, listDigests } from '../db/digests';
import { runDailyDigest } from '../jobs/daily-digest';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

export async function handleListDigests(c: AppContext) {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10) || 30, 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;

  try {
    const digests = await listDigests(c.env.DB, userId, limit, offset);
    return c.json({ digests });
  } catch (err) {
    console.error('handleListDigests:', err);
    return c.json({ error: 'Failed to load digests' }, 500);
  }
}

export async function handleGetDigest(c: AppContext) {
  const userId = c.get('userId');
  const date = c.req.param('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'Invalid date — expected YYYY-MM-DD' }, 400);
  }
  try {
    const digest = await getDigestByDate(c.env.DB, userId, date);
    if (!digest) return c.json({ error: 'Digest not found' }, 404);
    return c.json({ digest });
  } catch (err) {
    console.error('handleGetDigest:', err);
    return c.json({ error: 'Failed to load digest' }, 500);
  }
}

export async function handleGenerateDigestNow(c: AppContext) {
  const userId = c.get('userId');
  try {
    await runDailyDigest(c.env, userId);
    return c.json({ status: 'ok' });
  } catch (err) {
    console.error('handleGenerateDigestNow:', err);
    return c.json({ error: 'Failed to generate digest' }, 500);
  }
}
