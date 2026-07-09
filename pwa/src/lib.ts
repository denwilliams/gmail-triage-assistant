import type { Bucket, EmailItem, RangeId } from './types';

export const BUCKET_META: Record<Bucket, { name: string; desc: string }> = {
  human: { name: 'Humans', desc: 'Grouped by sender' },
  calendar: { name: 'Calendar', desc: 'Chronological event order' },
  security: { name: 'Security', desc: 'Action items first, OTPs last' },
  notification: { name: 'Notifications', desc: 'Severity, then urgency' },
  transactional: { name: 'Transactional', desc: 'Grouped by vendor' },
  newsletter: { name: 'Newsletters', desc: 'Ordered by interestingness' },
};

export function senderDisplay(addr: string): { name: string; email: string } {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  // Bare address — use the mailbox part as a readable name.
  const at = addr.indexOf('@');
  return { name: at > 0 ? addr.slice(0, at) : addr, email: addr };
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function formatTime(iso: string, tz?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

export function formatDayTime(iso: string, tz?: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

/** Row timestamp: time-of-day inside a single day, date+time for longer ranges. */
export function rowTime(iso: string, range: RangeId, tz?: string): string {
  return range === 'day' || range === '24h' ? formatTime(iso, tz) : formatDayTime(iso, tz);
}

export function formatEventTime(iso: string | null, tz?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

/** Extract a 4–8 digit code from OTP email subjects/summaries. */
export function extractOtpCode(e: EmailItem): string | null {
  const m = `${e.subject} ${e.summary}`.match(/\b(\d{4,8})\b/);
  return m ? m[1] : null;
}

/** Cross-bucket "needs attention" test used by the home feed. */
export function needsAttention(e: EmailItem): boolean {
  if (e.bucket === 'security' && !e.is_otp) return true;
  if (e.severity === 'high' || e.severity === 'critical') return true;
  if (e.bucket === 'calendar') return true;
  return false;
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const URGENCY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function sortNotifications(emails: EmailItem[]): EmailItem[] {
  return [...emails].sort((a, b) => {
    const s = (SEVERITY_RANK[b.severity ?? 'low'] ?? 0) - (SEVERITY_RANK[a.severity ?? 'low'] ?? 0);
    if (s) return s;
    const u = (URGENCY_RANK[b.urgency ?? 'low'] ?? 0) - (URGENCY_RANK[a.urgency ?? 'low'] ?? 0);
    if (u) return u;
    return b.processed_at.localeCompare(a.processed_at);
  });
}

export function amountValue(amount: string | null): number {
  if (!amount) return 0;
  const n = parseFloat(amount.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}
