// ============================================================================
// Sender rating sweep
// ----------------------------------------------------------------------------
// Nightly: for each active user, find sender_profiles that need a (re-)rating
// and call the sender_rating AI stage to produce a 0-100 rating + short
// reasoning. Auto-learned ratings don't overwrite manual overrides.
// ============================================================================

import type { Env } from '../types/env';
import type { SenderProfile } from '../types/models';

import { getActiveUsers } from '../db/users';
import {
  getAllSenderProfiles,
  getSenderProfileByID,
  upsertSenderProfile,
  topLabels,
  topSlugs,
  bypassInboxRate,
  notificationRate,
} from '../db/sender-profiles';
import { rateSender } from '../services/ai';

const MAX_PROFILES_PER_USER_PER_SWEEP = 50;
const RATING_STALE_DAYS = 30;
const MIN_EMAILS_FOR_RATING = 2;

function daysSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(iso).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Does this profile need a new auto-rating? Manual overrides are always
 * skipped, but they'd normally be noticed by UI hints rather than the sweep.
 */
function needsRating(profile: SenderProfile): boolean {
  if (profile.ratingManual) return false;
  if (profile.emailCount < MIN_EMAILS_FOR_RATING) return false;
  if (profile.rating === null) return true;
  return daysSince(profile.ratingUpdatedAt) >= RATING_STALE_DAYS;
}

function buildSignals(profile: SenderProfile): string {
  const archive = Math.round(bypassInboxRate(profile) * 100);
  const notify = Math.round(notificationRate(profile) * 100);
  const lines = [
    `Profile type: ${profile.profileType}`,
    `Classification: ${profile.senderType || 'unknown'}`,
    `Emails seen: ${profile.emailCount}`,
    `Archive rate: ${archive}%`,
    `Notification rate: ${notify}%`,
  ];
  const slugs = topSlugs(profile, 5);
  if (slugs.length) lines.push(`Top slugs: ${slugs.join(', ')}`);
  const labels = topLabels(profile, 5);
  if (labels.length) lines.push(`Top labels: ${labels.join(', ')}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);
  if (profile.bucketConsistency !== 'unknown') {
    lines.push(`Bucket consistency: ${profile.bucketConsistency}${profile.primaryBucket ? ' (' + profile.primaryBucket + ')' : ''}`);
  }
  return lines.join('\n');
}

export async function rateOneSender(
  env: Env,
  userId: number,
  profileId: number,
): Promise<SenderProfile | null> {
  const profile = await getSenderProfileByID(env.DB, userId, profileId);
  if (!profile) return null;
  if (profile.ratingManual) return profile;

  const result = await rateSender(env, {
    identifier: profile.identifier,
    senderType: profile.senderType || 'unknown',
    aggregatedSignals: buildSignals(profile),
  });

  const clamped = Math.max(0, Math.min(100, Math.round(result.rating)));
  profile.rating = clamped;
  profile.ratingReasoning = result.reasoning;
  profile.ratingUpdatedAt = new Date().toISOString();
  await upsertSenderProfile(env.DB, profile);
  return profile;
}

export async function runSenderRatingSweep(env: Env): Promise<void> {
  const users = await getActiveUsers(env.DB);
  console.log(`sender-rating-sweep: ${users.length} active users`);

  for (const user of users) {
    if (user.pipelineVersion !== 'v2') continue;

    try {
      const { profiles } = await getAllSenderProfiles(
        env.DB,
        user.id,
        { profileType: null, search: null, sort: 'volume' },
        500,
        0,
      );
      const candidates = profiles.filter(needsRating).slice(0, MAX_PROFILES_PER_USER_PER_SWEEP);
      console.log(`sender-rating-sweep: [${user.email}] ${candidates.length} profiles queued`);

      for (const profile of candidates) {
        try {
          await rateOneSender(env, user.id, profile.id);
        } catch (err) {
          console.error(`sender-rating-sweep: [${user.email}] ${profile.identifier} failed:`, err);
        }
      }
    } catch (err) {
      console.error(`sender-rating-sweep: user ${user.email} failed:`, err);
    }
  }
}
