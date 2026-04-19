// Shared helpers for v2 pipeline stages.

import type { Env } from '../types/env';
import type {
  Bucket,
  BucketConsistency,
  Email,
  ProfileType,
  SenderProfile,
  User,
} from '../types/models';

import { refreshAccessToken } from '../services/gmail';
import { updateUserToken } from '../db/users';
import {
  findLatestEmailInThread,
  getEmailByID,
  getHistoricalEmailsFromAddress,
  getHistoricalEmailsFromDomain,
} from '../db/emails';
import {
  getSenderProfile,
  upsertSenderProfile,
  extractDomain,
  isIgnoredDomain,
  buildProfileFromEmails,
} from '../db/sender-profiles';

// ---------------------------------------------------------------------------
// Consistency thresholds
// ---------------------------------------------------------------------------

export const CONSISTENCY_MIN_SAMPLES = 5;
export const CONSISTENCY_THRESHOLD = 0.9;

// ---------------------------------------------------------------------------
// Queue routing
// ---------------------------------------------------------------------------

export function getBucketQueue(env: Env, bucket: Bucket): Queue {
  switch (bucket) {
    case 'newsletter': return env.BUCKET_NEWSLETTER_QUEUE;
    case 'notification': return env.BUCKET_NOTIFICATION_QUEUE;
    case 'human': return env.BUCKET_HUMAN_QUEUE;
    case 'transactional': return env.BUCKET_TRANSACTIONAL_QUEUE;
    case 'security': return env.BUCKET_SECURITY_QUEUE;
    case 'calendar': return env.BUCKET_CALENDAR_QUEUE;
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function ensureFreshToken(env: Env, user: User): Promise<string> {
  const tokenExpiry = new Date(user.tokenExpiry).getTime();
  if (tokenExpiry > Date.now()) return user.accessToken;

  const refreshed = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    user.refreshToken,
  );
  const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await updateUserToken(env.DB, user.id, refreshed.access_token, user.refreshToken, newExpiry);
  return refreshed.access_token;
}

// ---------------------------------------------------------------------------
// Sender profile helpers
// ---------------------------------------------------------------------------

export async function loadOrBootstrapProfile(
  env: Env,
  userId: number,
  profileType: ProfileType,
  identifier: string,
): Promise<SenderProfile | null> {
  try {
    const existing = await getSenderProfile(env.DB, userId, profileType, identifier);
    if (existing) return existing;
  } catch (err) {
    console.log(`loadOrBootstrapProfile: error reading ${profileType} ${identifier}: ${err}`);
    return null;
  }

  // Bootstrap from historical emails — no AI call here; sender-type + summary
  // are evolved by the nightly rating sweep / bucket processors.
  let emails: Email[];
  try {
    emails = profileType === 'sender'
      ? await getHistoricalEmailsFromAddress(env.DB, userId, identifier, 25)
      : await getHistoricalEmailsFromDomain(env.DB, userId, identifier, 25);
  } catch (err) {
    console.log(`loadOrBootstrapProfile: error reading history for ${identifier}: ${err}`);
    return null;
  }

  const profile = buildProfileFromEmails(userId, profileType, identifier, emails);
  try {
    await upsertSenderProfile(env.DB, profile);
  } catch (err) {
    console.log(`loadOrBootstrapProfile: error saving ${identifier}: ${err}`);
    return null;
  }
  return profile;
}

export async function loadSenderAndDomainProfiles(
  env: Env,
  userId: number,
  fromAddress: string,
): Promise<{ sender: SenderProfile | null; domain: SenderProfile | null }> {
  const sender = await loadOrBootstrapProfile(env, userId, 'sender', fromAddress);
  const domain = isIgnoredDomain(extractDomain(fromAddress))
    ? null
    : await loadOrBootstrapProfile(env, userId, 'domain', extractDomain(fromAddress));
  return { sender, domain };
}

// ---------------------------------------------------------------------------
// Bucket consistency evaluation
// ---------------------------------------------------------------------------

export interface ConsistencyUpdate {
  consistency: BucketConsistency;
  primaryBucket: Bucket | null;
  bucketCounts: Record<string, number>;
}

/**
 * Recompute a sender's bucket_consistency after a new triage outcome.
 *
 * Rules:
 * - < CONSISTENCY_MIN_SAMPLES total → 'unknown'.
 * - Top bucket has >= CONSISTENCY_THRESHOLD share → 'consistent'.
 * - Otherwise → 'mixed'.
 *
 * If the profile was already consistent but the new bucket disagrees with
 * primary_bucket, drop back to 'unknown' — we want more samples before
 * re-deciding.
 */
export function updateBucketConsistency(
  profile: SenderProfile,
  newBucket: Bucket,
): ConsistencyUpdate {
  const counts: Record<string, number> = { ...profile.bucketCounts };
  counts[newBucket] = (counts[newBucket] ?? 0) + 1;

  // Consistent sender disagreement → reset counts to just this bucket and
  // go back to 'unknown' until we have fresh samples.
  if (
    profile.bucketConsistency === 'consistent'
    && profile.primaryBucket
    && profile.primaryBucket !== newBucket
  ) {
    const resetCounts: Record<string, number> = { [newBucket]: 1 };
    return { consistency: 'unknown', primaryBucket: null, bucketCounts: resetCounts };
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total < CONSISTENCY_MIN_SAMPLES) {
    return { consistency: 'unknown', primaryBucket: null, bucketCounts: counts };
  }

  // Find the top bucket
  let topBucket: Bucket = newBucket;
  let topCount = 0;
  for (const [b, c] of Object.entries(counts)) {
    if (c > topCount) {
      topCount = c;
      topBucket = b as Bucket;
    }
  }

  const share = topCount / total;
  if (share >= CONSISTENCY_THRESHOLD) {
    return { consistency: 'consistent', primaryBucket: topBucket, bucketCounts: counts };
  }
  return { consistency: 'mixed', primaryBucket: null, bucketCounts: counts };
}

// ---------------------------------------------------------------------------
// Sender context formatter (lightweight — used in triage)
// ---------------------------------------------------------------------------

export function formatSenderContextShort(
  sender: SenderProfile | null,
  domain: SenderProfile | null,
): string {
  const lines: string[] = [];
  if (sender && sender.emailCount > 0) {
    lines.push(
      `Sender ${sender.identifier}: seen ${sender.emailCount} times, ` +
      `type ${sender.senderType || 'unknown'}, ` +
      `bucket_consistency=${sender.bucketConsistency}` +
      (sender.primaryBucket ? ` (primary: ${sender.primaryBucket})` : ''),
    );
    if (sender.summary) lines.push(`  Summary: ${sender.summary}`);
  }
  if (domain && domain.emailCount > 0) {
    lines.push(
      `Domain ${domain.identifier}: seen ${domain.emailCount} times, ` +
      `type ${domain.senderType || 'unknown'}, ` +
      `bucket_consistency=${domain.bucketConsistency}`,
    );
  }
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

// ---------------------------------------------------------------------------
// Thread-reply fast-path lookup
// ---------------------------------------------------------------------------

export async function findPriorThreadBucket(
  env: Env,
  userId: number,
  threadId: string | null,
): Promise<Bucket | null> {
  if (!threadId) return null;
  const prior = await findLatestEmailInThread(env.DB, userId, threadId);
  if (!prior) return null;
  return prior.bucket;
}

// Re-export so callers don't have to import from two places.
export { getEmailByID };
