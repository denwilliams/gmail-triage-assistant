import type { SenderProfile, SenderProfileRow, ProfileType, Email } from '../types/models';

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function mapSenderProfile(row: SenderProfileRow): SenderProfile {
  return {
    id: row.id,
    userId: row.user_id,
    profileType: row.profile_type as ProfileType,
    identifier: row.identifier,
    emailCount: row.email_count,
    emailsArchived: row.emails_archived,
    emailsNotified: row.emails_notified,
    slugCounts: safeParseJSON<Record<string, number>>(row.slug_counts, {}),
    labelCounts: safeParseJSON<Record<string, number>>(row.label_counts, {}),
    keywordCounts: safeParseJSON<Record<string, number>>(row.keyword_counts, {}),
    senderType: row.sender_type,
    summary: row.summary,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    modifiedAt: row.modified_at,
    createdAt: row.created_at,
  };
}

const PROFILE_SELECT = `SELECT id, user_id, profile_type, identifier,
       email_count, emails_archived, emails_notified,
       slug_counts, label_counts, keyword_counts,
       sender_type, summary,
       first_seen_at, last_seen_at, modified_at, created_at
FROM sender_profiles`;

export async function getSenderProfile(
  db: D1Database,
  userId: number,
  profileType: ProfileType,
  identifier: string,
): Promise<SenderProfile | null> {
  const row = await db
    .prepare(`${PROFILE_SELECT} WHERE user_id = ? AND profile_type = ? AND identifier = ?`)
    .bind(userId, profileType, identifier)
    .first<SenderProfileRow>();
  return row ? mapSenderProfile(row) : null;
}

export async function getSenderProfileByID(
  db: D1Database,
  userId: number,
  profileId: number,
): Promise<SenderProfile | null> {
  const row = await db
    .prepare(`${PROFILE_SELECT} WHERE id = ? AND user_id = ?`)
    .bind(profileId, userId)
    .first<SenderProfileRow>();
  return row ? mapSenderProfile(row) : null;
}

export async function upsertSenderProfile(db: D1Database, profile: SenderProfile): Promise<void> {
  const slugCountsJSON = JSON.stringify(profile.slugCounts);
  const labelCountsJSON = JSON.stringify(profile.labelCounts);
  const keywordCountsJSON = JSON.stringify(profile.keywordCounts);

  await db
    .prepare(
      `INSERT INTO sender_profiles (
        user_id, profile_type, identifier,
        email_count, emails_archived, emails_notified,
        slug_counts, label_counts, keyword_counts,
        sender_type, summary,
        first_seen_at, last_seen_at, modified_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT (user_id, profile_type, identifier)
      DO UPDATE SET
        email_count = excluded.email_count,
        emails_archived = excluded.emails_archived,
        emails_notified = excluded.emails_notified,
        slug_counts = excluded.slug_counts,
        label_counts = excluded.label_counts,
        keyword_counts = excluded.keyword_counts,
        sender_type = excluded.sender_type,
        summary = excluded.summary,
        last_seen_at = excluded.last_seen_at,
        modified_at = datetime('now')`,
    )
    .bind(
      profile.userId,
      profile.profileType,
      profile.identifier,
      profile.emailCount,
      profile.emailsArchived,
      profile.emailsNotified,
      slugCountsJSON,
      labelCountsJSON,
      keywordCountsJSON,
      profile.senderType,
      profile.summary,
      profile.firstSeenAt,
      profile.lastSeenAt,
    )
    .run();
}

export async function deleteStaleProfiles(db: D1Database): Promise<number> {
  const result = await db
    .prepare("DELETE FROM sender_profiles WHERE modified_at < datetime('now', '-1 year')")
    .run();
  return result.meta.changes ?? 0;
}

// ============================================================================
// Utility functions (ported from Go models.go)
// ============================================================================

export const IGNORED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'outlook.com', 'live.com',
  'yahoo.com', 'yahoo.co.uk', 'aol.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me',
  'zoho.com', 'mail.com',
  'gmx.com', 'gmx.net',
  'yandex.com', 'tutanota.com', 'fastmail.com',
]);

export function isIgnoredDomain(domain: string): boolean {
  return IGNORED_DOMAINS.has(domain.toLowerCase());
}

export function extractDomain(email: string): string {
  const atIndex = email.lastIndexOf('@');
  if (atIndex < 0) return '';
  return email.slice(atIndex + 1).toLowerCase().replace(/[> ]+$/, '');
}

function topN(counts: Record<string, number>, n: number): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => `${key} (${count})`);
}

export function topSlugs(profile: SenderProfile, n: number): string[] {
  return topN(profile.slugCounts, n);
}

export function topLabels(profile: SenderProfile, n: number): string[] {
  return topN(profile.labelCounts, n);
}

export function topKeywords(profile: SenderProfile, n: number): string[] {
  return topN(profile.keywordCounts, n);
}

export function bypassInboxRate(profile: SenderProfile): number {
  if (profile.emailCount === 0) return 0;
  return profile.emailsArchived / profile.emailCount;
}

export function notificationRate(profile: SenderProfile): number {
  if (profile.emailCount === 0) return 0;
  return profile.emailsNotified / profile.emailCount;
}

export function formatProfileForPrompt(profile: SenderProfile): string {
  const bRate = bypassInboxRate(profile) * 100;
  const nRate = notificationRate(profile) * 100;
  let result = `Type: ${profile.senderType} | Emails: ${profile.emailCount} | Archive rate: ${Math.round(bRate)}% | Notification rate: ${Math.round(nRate)}%\n`;

  const slugs = topSlugs(profile, 5);
  if (slugs.length > 0) {
    result += `Top slugs: ${slugs.join(', ')}\n`;
  }
  const labels = topLabels(profile, 5);
  if (labels.length > 0) {
    result += `Top labels: ${labels.join(', ')}\n`;
  }
  if (profile.summary) {
    result += `Summary: ${profile.summary}\n`;
  }
  return result;
}

/**
 * Builds a sender profile from historical emails (for bootstrapping).
 */
export function buildProfileFromEmails(
  userId: number,
  profileType: ProfileType,
  identifier: string,
  emails: Email[],
): SenderProfile {
  const now = new Date().toISOString();
  const profile: SenderProfile = {
    id: 0,
    userId,
    profileType,
    identifier,
    emailCount: emails.length,
    emailsArchived: 0,
    emailsNotified: 0,
    slugCounts: {},
    labelCounts: {},
    keywordCounts: {},
    senderType: '',
    summary: '',
    firstSeenAt: now,
    lastSeenAt: now,
    modifiedAt: now,
    createdAt: now,
  };

  for (const e of emails) {
    if (e.slug) {
      profile.slugCounts[e.slug] = (profile.slugCounts[e.slug] ?? 0) + 1;
    }
    for (const label of e.labelsApplied) {
      profile.labelCounts[label] = (profile.labelCounts[label] ?? 0) + 1;
    }
    for (const kw of e.keywords) {
      profile.keywordCounts[kw] = (profile.keywordCounts[kw] ?? 0) + 1;
    }
    if (e.bypassedInbox) profile.emailsArchived++;
    if (e.notificationSent) profile.emailsNotified++;
    if (e.processedAt < profile.firstSeenAt) profile.firstSeenAt = e.processedAt;
    if (e.processedAt > profile.lastSeenAt) profile.lastSeenAt = e.processedAt;
  }

  return profile;
}
