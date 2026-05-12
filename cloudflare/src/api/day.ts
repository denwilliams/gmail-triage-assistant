import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Bucket, Email } from '../types/models';
import { getEmailsByDateRange } from '../db/emails';
import { getSenderProfile, extractDomain } from '../db/sender-profiles';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

// One row in the day view — a slimmed Email shape.
interface DayEmail {
  id: string;
  from_address: string;
  subject: string;
  summary: string;
  processed_at: string;
  thread_id: string | null;
  // Bucket-specific extras — only the fields the renderer needs.
  interesting_score: number | null;
  interesting_reasons: string[];
  severity: string | null;
  urgency: string | null;
  vendor: string | null;
  document_type: string | null;
  amount: string | null;
  action_type: string | null;
  is_otp: boolean | null;
  event_title: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  bypassed_inbox: boolean;
}

interface SenderGroup {
  from_address: string;
  rating: number | null;
  rating_manual: boolean;
  emails: DayEmail[];
}

interface VendorGroup {
  vendor: string;
  emails: DayEmail[];
}

interface DayResponse {
  date: string;
  today: string;       // server's notion of "today" in env.TIMEZONE
  timezone: string;    // the IANA tz used to resolve the date
  prev_date: string;
  next_date: string;
  total: number;
  bucket_totals: Record<Bucket, number>;
  sections: {
    human: { groups: SenderGroup[] };
    newsletter: { emails: DayEmail[] };
    notification: { emails: DayEmail[] };
    security: { emails: DayEmail[] };
    transactional: { groups: VendorGroup[] };
    calendar: { emails: DayEmail[] };
  };
}

function toDayEmail(e: Email): DayEmail {
  return {
    id: e.id,
    from_address: e.fromAddress,
    subject: e.subject,
    summary: e.summary,
    processed_at: e.processedAt,
    thread_id: e.threadId,
    interesting_score: e.interestingScore,
    interesting_reasons: e.interestingReasons ?? [],
    severity: e.severity,
    urgency: e.urgency,
    vendor: e.vendor,
    document_type: e.documentType,
    amount: e.amount,
    action_type: e.actionType,
    is_otp: e.isOtp,
    event_title: e.eventTitle,
    event_starts_at: e.eventStartsAt,
    event_ends_at: e.eventEndsAt,
    event_location: e.eventLocation,
    bypassed_inbox: e.bypassedInbox,
  };
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Wall-clock parts of `instant` viewed in tz, returned as a "fake UTC" epoch
// (i.e. Date.UTC of the local Y/M/D/h/m/s). The difference vs the real UTC
// epoch of `instant` is the tz offset at that instant.
function tzWallclockUTC(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return Date.UTC(
    parseInt(get('year'), 10),
    parseInt(get('month'), 10) - 1,
    parseInt(get('day'), 10),
    hour,
    parseInt(get('minute'), 10),
    parseInt(get('second'), 10),
  );
}

// Convert a local-date (YYYY-MM-DD) in tz to the UTC instant when that day
// starts. Iterates once to absorb DST transitions.
function localDateStartUTC(date: string, tz: string): Date {
  const localMidnightAsUtc = Date.UTC(
    parseInt(date.slice(0, 4), 10),
    parseInt(date.slice(5, 7), 10) - 1,
    parseInt(date.slice(8, 10), 10),
  );
  // First pass: estimate using the offset at the (wrong) instant.
  const offset0 = tzWallclockUTC(new Date(localMidnightAsUtc), tz) - localMidnightAsUtc;
  const guess1 = localMidnightAsUtc - offset0;
  // Second pass: re-evaluate offset at the corrected instant.
  const offset1 = tzWallclockUTC(new Date(guess1), tz) - guess1;
  return new Date(localMidnightAsUtc - offset1);
}

// "Today" in tz expressed as YYYY-MM-DD.
function todayInTZ(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Severity / urgency / action_type priorities — higher = more important = listed first.
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const URGENCY_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
const ACTION_TYPE_RANK: Record<string, number> = {
  login_alert: 5,
  account_recovery: 4,
  reset: 3,
  mfa: 2,
  other: 1,
};

function sortNewsletters(emails: Email[]): DayEmail[] {
  return [...emails]
    .sort((a, b) => {
      const sa = a.interestingScore ?? -1;
      const sb = b.interestingScore ?? -1;
      if (sb !== sa) return sb - sa;
      return b.processedAt.localeCompare(a.processedAt);
    })
    .map(toDayEmail);
}

function sortNotifications(emails: Email[]): DayEmail[] {
  return [...emails]
    .sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity ?? 'low'] ?? 0;
      const sb = SEVERITY_RANK[b.severity ?? 'low'] ?? 0;
      if (sb !== sa) return sb - sa;
      const ua = URGENCY_RANK[a.urgency ?? 'low'] ?? 0;
      const ub = URGENCY_RANK[b.urgency ?? 'low'] ?? 0;
      if (ub !== ua) return ub - ua;
      return b.processedAt.localeCompare(a.processedAt);
    })
    .map(toDayEmail);
}

function sortSecurity(emails: Email[]): DayEmail[] {
  return [...emails]
    .sort((a, b) => {
      // OTPs are short-lived and noisy — push them to the bottom.
      const aOtp = a.isOtp === true ? 1 : 0;
      const bOtp = b.isOtp === true ? 1 : 0;
      if (aOtp !== bOtp) return aOtp - bOtp;
      const ra = ACTION_TYPE_RANK[a.actionType ?? 'other'] ?? 0;
      const rb = ACTION_TYPE_RANK[b.actionType ?? 'other'] ?? 0;
      if (rb !== ra) return rb - ra;
      return b.processedAt.localeCompare(a.processedAt);
    })
    .map(toDayEmail);
}

function sortCalendar(emails: Email[]): DayEmail[] {
  return [...emails]
    .sort((a, b) => {
      // Events with a known start time come first, in chronological order;
      // undated event emails fall to the bottom ordered by processed time.
      const aHas = a.eventStartsAt ? 1 : 0;
      const bHas = b.eventStartsAt ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      if (a.eventStartsAt && b.eventStartsAt) {
        return a.eventStartsAt.localeCompare(b.eventStartsAt);
      }
      return b.processedAt.localeCompare(a.processedAt);
    })
    .map(toDayEmail);
}

async function groupHumans(
  env: Env,
  userId: number,
  emails: Email[],
): Promise<SenderGroup[]> {
  const byAddress = new Map<string, Email[]>();
  for (const e of emails) {
    const list = byAddress.get(e.fromAddress) ?? [];
    list.push(e);
    byAddress.set(e.fromAddress, list);
  }

  // Look up ratings for each unique sender (with domain fallback).
  const groups: SenderGroup[] = [];
  for (const [address, list] of byAddress) {
    let rating: number | null = null;
    let manual = false;
    const sender = await getSenderProfile(env.DB, userId, 'sender', address);
    if (sender?.rating !== undefined && sender?.rating !== null) {
      rating = sender.rating;
      manual = sender.ratingManual;
    } else {
      const domain = extractDomain(address);
      if (domain) {
        const dp = await getSenderProfile(env.DB, userId, 'domain', domain);
        if (dp?.rating !== undefined && dp?.rating !== null) {
          rating = dp.rating;
          manual = dp.ratingManual;
        }
      }
    }
    list.sort((a, b) => b.processedAt.localeCompare(a.processedAt));
    groups.push({
      from_address: address,
      rating,
      rating_manual: manual,
      emails: list.map(toDayEmail),
    });
  }

  // Order groups: highest rating first, unrated treated as -1 (last), then by
  // volume desc, then alphabetic.
  groups.sort((a, b) => {
    const ra = a.rating ?? -1;
    const rb = b.rating ?? -1;
    if (rb !== ra) return rb - ra;
    if (b.emails.length !== a.emails.length) return b.emails.length - a.emails.length;
    return a.from_address.localeCompare(b.from_address);
  });
  return groups;
}

function groupTransactional(emails: Email[]): VendorGroup[] {
  const byVendor = new Map<string, Email[]>();
  for (const e of emails) {
    // Fall back to the sender address when no vendor was extracted, so every
    // email is still visible somewhere on the page.
    const key = (e.vendor && e.vendor.trim()) || e.fromAddress;
    const list = byVendor.get(key) ?? [];
    list.push(e);
    byVendor.set(key, list);
  }
  const groups: VendorGroup[] = [];
  for (const [vendor, list] of byVendor) {
    list.sort((a, b) => b.processedAt.localeCompare(a.processedAt));
    groups.push({ vendor, emails: list.map(toDayEmail) });
  }
  groups.sort((a, b) => {
    if (b.emails.length !== a.emails.length) return b.emails.length - a.emails.length;
    return a.vendor.localeCompare(b.vendor);
  });
  return groups;
}

export async function handleGetDay(c: AppContext) {
  const userId = c.get('userId');
  const tz = c.env.TIMEZONE || 'UTC';
  const today = todayInTZ(tz);

  // No date param → today. This keeps `/api/v1/days` itself usable.
  const dateParam = c.req.param('date');
  const date = dateParam ?? today;
  if (!isValidDate(date)) {
    return c.json({ error: 'Invalid date — expected YYYY-MM-DD' }, 400);
  }

  const start = localDateStartUTC(date, tz);
  const end = localDateStartUTC(shiftDate(date, 1), tz);
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  try {
    const emails = await getEmailsByDateRange(c.env.DB, userId, startISO, endISO);

    const byBucket: Record<Bucket, Email[]> = {
      newsletter: [],
      notification: [],
      human: [],
      transactional: [],
      security: [],
      calendar: [],
    };
    for (const e of emails) {
      if (e.bucket && e.bucket in byBucket) {
        byBucket[e.bucket as Bucket].push(e);
      }
    }

    const response: DayResponse = {
      date,
      today,
      timezone: tz,
      prev_date: shiftDate(date, -1),
      next_date: shiftDate(date, 1),
      total: Object.values(byBucket).reduce((sum, arr) => sum + arr.length, 0),
      bucket_totals: {
        newsletter: byBucket.newsletter.length,
        notification: byBucket.notification.length,
        human: byBucket.human.length,
        transactional: byBucket.transactional.length,
        security: byBucket.security.length,
        calendar: byBucket.calendar.length,
      },
      sections: {
        human: { groups: await groupHumans(c.env, userId, byBucket.human) },
        newsletter: { emails: sortNewsletters(byBucket.newsletter) },
        notification: { emails: sortNotifications(byBucket.notification) },
        security: { emails: sortSecurity(byBucket.security) },
        transactional: { groups: groupTransactional(byBucket.transactional) },
        calendar: { emails: sortCalendar(byBucket.calendar) },
      },
    };

    return c.json(response);
  } catch (err) {
    console.error('handleGetDay:', err);
    return c.json({ error: 'Failed to load day view' }, 500);
  }
}
