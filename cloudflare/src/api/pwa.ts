// API for the PWA mail client served at /m/.
//
// Endpoints are mounted under /api/v1/m/* behind the same cookie auth as the
// dashboard. Reads come from D1 (already-processed emails); actions write to
// D1 and mirror to Gmail via the user's own OAuth token.

import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Bucket } from '../types/models';
import { getUserByID } from '../db/users';
import { getSenderProfile, extractDomain } from '../db/sender-profiles';
import { ensureFreshToken } from '../pipeline/shared';
import {
  archiveMessage,
  unarchiveMessage,
  trashMessage,
  setMessageRead,
  getMessageContent,
  sendReply,
  parseAddress,
} from '../services/gmail';
import { isValidDate, isoWeekday, localDateStartUTC, shiftDate, todayInTZ } from '../lib/tz';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

// Hono types :id params as string | undefined on a bare Context; every route
// here declares :id, so an empty fallback just turns into a 404 lookup.
function requireId(c: AppContext): string {
  return c.req.param('id') ?? '';
}

const BUCKETS: Bucket[] = ['newsletter', 'notification', 'human', 'transactional', 'security', 'calendar'];

// ---------------------------------------------------------------------------
// Time ranges
// ---------------------------------------------------------------------------

type RangeId = 'day' | 'week' | 'month' | '24h' | '7d' | '28d';

interface ResolvedRange {
  range: RangeId;
  /** UTC ISO bounds for the processed_at query. */
  startISO: string;
  endISO: string;
  /** Local-date anchor for calendar ranges; null for rolling windows. */
  anchor: string | null;
  prevAnchor: string | null;
  nextAnchor: string | null;
}

const ROLLING_HOURS: Record<string, number> = { '24h': 24, '7d': 7 * 24, '28d': 28 * 24 };

function resolveRange(range: RangeId, anchorParam: string | undefined, tz: string): ResolvedRange | null {
  if (range in ROLLING_HOURS) {
    const end = new Date();
    const start = new Date(end.getTime() - ROLLING_HOURS[range] * 3600_000);
    return {
      range,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      anchor: null,
      prevAnchor: null,
      nextAnchor: null,
    };
  }

  const today = todayInTZ(tz);
  const anchor = anchorParam && isValidDate(anchorParam) ? anchorParam : today;

  let startDate: string;
  let endDate: string; // exclusive
  let prevAnchor: string;
  let nextAnchor: string;

  if (range === 'day') {
    startDate = anchor;
    endDate = shiftDate(anchor, 1);
    prevAnchor = shiftDate(anchor, -1);
    nextAnchor = shiftDate(anchor, 1);
  } else if (range === 'week') {
    startDate = shiftDate(anchor, -(isoWeekday(anchor) - 1)); // Monday
    endDate = shiftDate(startDate, 7);
    prevAnchor = shiftDate(startDate, -7);
    nextAnchor = shiftDate(startDate, 7);
  } else if (range === 'month') {
    startDate = `${anchor.slice(0, 7)}-01`;
    const [y, m] = [parseInt(anchor.slice(0, 4), 10), parseInt(anchor.slice(5, 7), 10)];
    endDate = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    prevAnchor = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
    nextAnchor = endDate;
  } else {
    return null;
  }

  return {
    range,
    startISO: localDateStartUTC(startDate, tz).toISOString(),
    endISO: localDateStartUTC(endDate, tz).toISOString(),
    anchor: startDate,
    prevAnchor,
    nextAnchor,
  };
}

// ---------------------------------------------------------------------------
// Email list
// ---------------------------------------------------------------------------

// The subset of email columns the client renders, plus PWA state columns.
// snake_case is preserved in the JSON payload.
const LIST_COLUMNS = `id, thread_id, from_address, subject, summary, processed_at, bucket,
  severity, urgency, interesting_score, interesting_reasons,
  vendor, document_type, amount, action_type, is_otp,
  event_title, event_starts_at, event_ends_at, event_location,
  triage_via, is_read, archived_at, collapsed`;

interface ListRow {
  id: string;
  thread_id: string | null;
  from_address: string;
  subject: string;
  summary: string;
  processed_at: string;
  bucket: string;
  severity: string | null;
  urgency: string | null;
  interesting_score: number | null;
  interesting_reasons: string | null;
  vendor: string | null;
  document_type: string | null;
  amount: string | null;
  action_type: string | null;
  is_otp: number | null;
  event_title: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  triage_via: string | null;
  is_read: number;
  archived_at: string | null;
  collapsed: number;
}

function rowToJSON(r: ListRow) {
  let reasons: string[] = [];
  try {
    reasons = JSON.parse(r.interesting_reasons ?? '[]');
  } catch {
    // ignore malformed
  }
  return {
    ...r,
    interesting_reasons: reasons,
    is_otp: r.is_otp === null ? null : r.is_otp === 1,
    is_read: r.is_read === 1,
    collapsed: r.collapsed === 1,
  };
}

const LIST_LIMIT = 500;

export async function handleGetPwaEmails(c: AppContext) {
  const userId = c.get('userId');
  const tz = c.env.TIMEZONE || 'UTC';

  const rangeParam = (c.req.query('range') ?? 'day') as RangeId;
  const resolved = resolveRange(rangeParam, c.req.query('anchor'), tz);
  if (!resolved) {
    return c.json({ error: 'Invalid range — expected day|week|month|24h|7d|28d' }, 400);
  }

  const bucket = c.req.query('bucket');
  if (bucket && !BUCKETS.includes(bucket as Bucket)) {
    return c.json({ error: 'Invalid bucket' }, 400);
  }

  try {
    let sql = `SELECT ${LIST_COLUMNS} FROM emails
      WHERE user_id = ? AND bucket IS NOT NULL AND processed_at >= ? AND processed_at < ?`;
    const binds: unknown[] = [userId, resolved.startISO, resolved.endISO];
    if (bucket) {
      sql += ' AND bucket = ?';
      binds.push(bucket);
    }
    sql += ` ORDER BY processed_at DESC LIMIT ${LIST_LIMIT}`;

    const { results } = await c.env.DB.prepare(sql).bind(...binds).all<ListRow>();
    const emails = (results ?? []).map(rowToJSON);

    // Ratings for human senders (with domain fallback), used by the feed and
    // the humans bucket view.
    const humanAddresses = [...new Set(
      emails.filter((e) => e.bucket === 'human').map((e) => e.from_address),
    )];
    const ratings: Record<string, { rating: number | null; manual: boolean }> = {};
    for (const address of humanAddresses) {
      let rating: number | null = null;
      let manual = false;
      const sender = await getSenderProfile(c.env.DB, userId, 'sender', address);
      if (sender?.rating !== undefined && sender?.rating !== null) {
        rating = sender.rating;
        manual = sender.ratingManual;
      } else {
        const domain = extractDomain(address);
        if (domain) {
          const dp = await getSenderProfile(c.env.DB, userId, 'domain', domain);
          if (dp?.rating !== undefined && dp?.rating !== null) {
            rating = dp.rating;
            manual = dp.ratingManual;
          }
        }
      }
      ratings[address] = { rating, manual };
    }

    return c.json({
      range: resolved.range,
      start: resolved.startISO,
      end: resolved.endISO,
      anchor: resolved.anchor,
      prev_anchor: resolved.prevAnchor,
      next_anchor: resolved.nextAnchor,
      today: todayInTZ(tz),
      timezone: tz,
      truncated: emails.length === LIST_LIMIT,
      emails,
      ratings,
    });
  } catch (err) {
    console.error('handleGetPwaEmails:', err);
    return c.json({ error: 'Failed to load emails' }, 500);
  }
}

// ---------------------------------------------------------------------------
// Message content (full body from Gmail)
// ---------------------------------------------------------------------------

/**
 * Strip active content from untrusted email HTML. The client additionally
 * renders it inside a sandboxed iframe (no scripts), so this is defence in
 * depth rather than the only barrier.
 */
function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<(iframe|object|embed|form|base|meta)\b[\s\S]*?(\/>|<\/\1\s*>)/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1=$2#$2');
}

async function loadUserAndEmail(c: AppContext, emailId: string) {
  const userId = c.get('userId');
  const row = await c.env.DB
    .prepare('SELECT id, thread_id, from_address, subject FROM emails WHERE id = ? AND user_id = ?')
    .bind(emailId, userId)
    .first<{ id: string; thread_id: string | null; from_address: string; subject: string }>();
  if (!row) return null;
  const user = await getUserByID(c.env.DB, userId);
  if (!user) return null;
  return { row, user };
}

export async function handleGetPwaEmailContent(c: AppContext) {
  const emailId = requireId(c);
  try {
    const loaded = await loadUserAndEmail(c, emailId);
    if (!loaded) return c.json({ error: 'Not found' }, 404);
    const token = await ensureFreshToken(c.env, loaded.user);
    const content = await getMessageContent(token, emailId);
    return c.json({
      from_header: content.fromHeader,
      reply_to: content.replyTo,
      subject: content.subject,
      text: content.text,
      html: content.html ? sanitizeEmailHtml(content.html) : '',
    });
  } catch (err) {
    console.error('handleGetPwaEmailContent:', err);
    return c.json({ error: 'Failed to load message from Gmail' }, 502);
  }
}

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

export async function handlePwaReply(c: AppContext) {
  const emailId = requireId(c);
  const { body } = await c.req.json<{ body?: string }>().catch(() => ({ body: undefined }));
  if (!body || !body.trim()) {
    return c.json({ error: 'Reply body is required' }, 400);
  }

  try {
    const loaded = await loadUserAndEmail(c, emailId);
    if (!loaded) return c.json({ error: 'Not found' }, 404);
    const token = await ensureFreshToken(c.env, loaded.user);

    // Pull threading headers from the original message.
    const original = await getMessageContent(token, emailId);
    const to = original.replyTo || original.fromHeader || loaded.row.from_address;
    const sent = await sendReply(token, {
      threadId: original.threadId,
      to,
      subject: original.subject || loaded.row.subject,
      inReplyTo: original.messageIdHeader,
      references: original.references,
      body: body.trim(),
    });

    return c.json({ ok: true, sent_id: sent.id, to: parseAddress(to) });
  } catch (err) {
    console.error('handlePwaReply:', err);
    return c.json({ error: 'Failed to send reply' }, 502);
  }
}

// ---------------------------------------------------------------------------
// Actions — archive / trash / read / collapse / move bucket
// ---------------------------------------------------------------------------

type GmailAction = (token: string, messageId: string) => Promise<void>;

/**
 * Run a state action: update D1 (source of truth for the app) and mirror to
 * Gmail. Gmail failures are reported but don't roll back the local state —
 * the message may legitimately no longer exist (timed delete, manual trash).
 */
async function runAction(
  c: AppContext,
  emailId: string,
  sql: string,
  binds: unknown[],
  gmailAction: GmailAction | null,
) {
  const userId = c.get('userId');
  const result = await c.env.DB
    .prepare(`${sql} WHERE id = ? AND user_id = ?`)
    .bind(...binds, emailId, userId)
    .run();
  if (!result.meta.rows_written) {
    return c.json({ error: 'Not found' }, 404);
  }

  let gmailError: string | null = null;
  if (gmailAction) {
    try {
      const user = await getUserByID(c.env.DB, userId);
      if (!user) throw new Error('user not found');
      const token = await ensureFreshToken(c.env, user);
      await gmailAction(token, emailId);
    } catch (err) {
      console.error('pwa gmail action failed:', err);
      gmailError = 'Saved here, but updating Gmail failed';
    }
  }
  return c.json({ ok: true, gmail_error: gmailError });
}

export async function handlePwaArchive(c: AppContext) {
  return runAction(
    c,
    requireId(c),
    'UPDATE emails SET archived_at = ?, is_read = 1',
    [new Date().toISOString()],
    (t, id) => archiveMessage(t, id),
  );
}

export async function handlePwaUnarchive(c: AppContext) {
  return runAction(
    c,
    requireId(c),
    'UPDATE emails SET archived_at = NULL',
    [],
    (t, id) => unarchiveMessage(t, id),
  );
}

export async function handlePwaTrash(c: AppContext) {
  return runAction(
    c,
    requireId(c),
    'UPDATE emails SET archived_at = ?, is_read = 1',
    [new Date().toISOString()],
    (t, id) => trashMessage(t, id),
  );
}

export async function handlePwaSetRead(c: AppContext) {
  const { read } = await c.req.json<{ read?: boolean }>().catch(() => ({ read: undefined }));
  const value = read !== false; // default true
  return runAction(
    c,
    requireId(c),
    'UPDATE emails SET is_read = ?',
    [value ? 1 : 0],
    (t, id) => setMessageRead(t, id, value),
  );
}

export async function handlePwaSetCollapsed(c: AppContext) {
  const { collapsed } = await c.req.json<{ collapsed?: boolean }>().catch(() => ({ collapsed: undefined }));
  // App-only state; nothing to mirror to Gmail.
  return runAction(
    c,
    requireId(c),
    'UPDATE emails SET collapsed = ?',
    [collapsed === false ? 0 : 1],
    null,
  );
}

export async function handlePwaSetBucket(c: AppContext) {
  const { bucket } = await c.req.json<{ bucket?: string }>().catch(() => ({ bucket: undefined }));
  if (!bucket || !BUCKETS.includes(bucket as Bucket)) {
    return c.json({ error: 'Invalid bucket' }, 400);
  }
  // Correction is recorded on the email itself; the sender-profile learning
  // loop picks corrections up via the existing feedback sweep.
  return runAction(
    c,
    requireId(c),
    'UPDATE emails SET bucket = ?, feedback_dirty = 1',
    [bucket],
    null,
  );
}
