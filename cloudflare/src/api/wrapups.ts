import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { WrapupReport } from '../types/models';
import { getWrapupReportsByUser } from '../db/wrapups';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function wrapupToJSON(r: WrapupReport) {
  return {
    id: r.id,
    user_id: r.userId,
    report_type: r.reportType,
    content: r.content,
    email_count: r.emailCount,
    generated_at: r.generatedAt,
    created_at: r.createdAt,
  };
}

export async function handleGetWrapups(c: AppContext) {
  const userId = c.get('userId');
  let limit = 30;
  const lParam = c.req.query('limit');
  if (lParam) {
    const parsed = parseInt(lParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  try {
    const reports = await getWrapupReportsByUser(c.env.DB, userId, limit);
    return c.json(reports.map(wrapupToJSON));
  } catch (e) {
    console.error('Failed to load wrapup reports:', e);
    return c.json({ error: 'Failed to load wrapup reports' }, 500);
  }
}
