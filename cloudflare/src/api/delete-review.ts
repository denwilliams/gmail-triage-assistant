import type { Context } from 'hono';
import type { Env } from '../types/env';
import { getUserByID } from '../db/users';
import { getEmailsByIDs } from '../db/emails';
import { ensureFreshToken } from '../pipeline/shared';
import {
  listLabels,
  listMessagesByLabel,
  batchModifyMessages,
  removeLabels,
  trashMessage,
} from '../services/gmail';
import { DELETE_LABELS, listDueMessageIds } from '../jobs/timed-labels';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

// Caps a single "run" click's Gmail subrequests to a sane number. Callers can
// just click again to process the remainder.
const RUN_CAP = 200;
const RUN_CONCURRENCY = 8;

interface DeleteReviewRow {
  id: string;
  subject: string;
  from: string;
  tier: string;
  due: boolean;
  processed_at: string | null;
}

export async function handleGetDeleteReview(c: AppContext) {
  const userId = c.get('userId');
  try {
    const user = await getUserByID(c.env.DB, userId);
    if (!user) return c.json({ error: 'User not found' }, 404);
    const accessToken = await ensureFreshToken(c.env, user);

    const allLabels = await listLabels(accessToken);
    const labelIdByName = new Map(allLabels.map((l) => [l.name, l.id]));

    const tierMeta = new Map<string, { tier: string; due: boolean }>();
    const tierCounts: Array<{ tier: string; total: number; due: number }> = [];

    for (const tl of DELETE_LABELS) {
      const labelId = labelIdByName.get(tl.name);
      if (!labelId) {
        tierCounts.push({ tier: tl.name, total: 0, due: 0 });
        continue;
      }

      const [allMsgs, dueIds] = await Promise.all([
        listMessagesByLabel(accessToken, labelId),
        listDueMessageIds(accessToken, labelId, tl),
      ]);
      const dueSet = new Set(dueIds);
      for (const m of allMsgs) {
        tierMeta.set(m.id, { tier: tl.name, due: dueSet.has(m.id) });
      }
      tierCounts.push({ tier: tl.name, total: allMsgs.length, due: dueIds.length });
    }

    const allIds = [...tierMeta.keys()];
    const emails = await getEmailsByIDs(c.env.DB, userId, allIds);
    const emailById = new Map(emails.map((e) => [e.id, e]));

    const rows: DeleteReviewRow[] = allIds.map((id) => {
      const meta = tierMeta.get(id)!;
      const email = emailById.get(id);
      return {
        id,
        subject: email?.subject || '(unknown subject)',
        from: email?.fromAddress || '',
        tier: meta.tier,
        due: meta.due,
        processed_at: email?.processedAt ?? null,
      };
    });

    // Due first, then oldest-processed first within each group.
    rows.sort((a, b) => {
      if (a.due !== b.due) return a.due ? -1 : 1;
      return (a.processed_at ?? '').localeCompare(b.processed_at ?? '');
    });

    return c.json({
      rows,
      tiers: tierCounts,
      total: rows.length,
      due_total: rows.filter((r) => r.due).length,
    });
  } catch (err) {
    console.error('handleGetDeleteReview:', err);
    return c.json({ error: 'Failed to load delete review' }, 500);
  }
}

export async function handleExemptFromDelete(c: AppContext) {
  const userId = c.get('userId');
  const body = await c.req.json<{ message_ids?: string[] }>().catch(() => null);
  if (!body || !Array.isArray(body.message_ids) || body.message_ids.length === 0) {
    return c.json({ error: 'Invalid JSON: expected { message_ids: string[] }' }, 400);
  }

  try {
    const user = await getUserByID(c.env.DB, userId);
    if (!user) return c.json({ error: 'User not found' }, 404);
    const accessToken = await ensureFreshToken(c.env, user);

    const allLabels = await listLabels(accessToken);
    const deleteLabelIds = DELETE_LABELS.map((tl) => allLabels.find((l) => l.name === tl.name)?.id).filter(
      (id): id is string => !!id,
    );

    if (deleteLabelIds.length > 0) {
      await batchModifyMessages(accessToken, body.message_ids, { removeLabelIds: deleteLabelIds });
    }

    return c.json({ status: 'ok', exempted: body.message_ids.length });
  } catch (err) {
    console.error('handleExemptFromDelete:', err);
    return c.json({ error: 'Failed to exempt messages' }, 500);
  }
}

export async function handleRunDeleteSweep(c: AppContext) {
  const userId = c.get('userId');
  try {
    const user = await getUserByID(c.env.DB, userId);
    if (!user) return c.json({ error: 'User not found' }, 404);
    const accessToken = await ensureFreshToken(c.env, user);

    const allLabels = await listLabels(accessToken);
    const labelIdByName = new Map(allLabels.map((l) => [l.name, l.id]));

    // Recompute due IDs fresh rather than trusting a client-supplied list —
    // this is also what makes exemption work: a message with its label
    // already removed simply won't match the older_than: query below.
    const due: Array<{ id: string; labelId: string }> = [];
    for (const tl of DELETE_LABELS) {
      const labelId = labelIdByName.get(tl.name);
      if (!labelId) continue;
      const ids = await listDueMessageIds(accessToken, labelId, tl);
      for (const id of ids) due.push({ id, labelId });
    }

    const toProcess = due.slice(0, RUN_CAP);
    let trashed = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i += RUN_CONCURRENCY) {
      const batch = toProcess.slice(i, i + RUN_CONCURRENCY);
      await Promise.all(
        batch.map(async ({ id, labelId }) => {
          try {
            await removeLabels(accessToken, id, [labelId]);
            await trashMessage(accessToken, id);
            trashed++;
          } catch (e) {
            console.error(`handleRunDeleteSweep: failed to trash ${id}:`, e);
            errors++;
          }
        }),
      );
    }

    return c.json({
      status: 'ok',
      trashed,
      remaining: Math.max(due.length - toProcess.length, 0),
      errors,
    });
  } catch (err) {
    console.error('handleRunDeleteSweep:', err);
    return c.json({ error: 'Failed to run delete sweep' }, 500);
  }
}
