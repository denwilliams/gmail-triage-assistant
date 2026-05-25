// ============================================================================
// Daily digest job
// ----------------------------------------------------------------------------
// Runs at 8 AM via cron (alongside the morning wrapup) for each v2 user.
// Gathers the last 24 hours of processed emails, groups them into three
// sections, composes the digest, sends it via the user's own Gmail token,
// and persists the result to daily_digests.
// ============================================================================

import type { Env } from '../types/env';
import type {
  DigestNewsletterItem,
  DigestNotificationItem,
  DigestQuietHumanItem,
  DigestSections,
  Email,
  SenderProfile,
} from '../types/models';

import { getUserByID } from '../db/users';
import { getEmailsByBucket, markIncludedInDigest } from '../db/emails';
import { getSenderProfile, extractDomain } from '../db/sender-profiles';
import { upsertDigest } from '../db/digests';

import { sendHtmlMessage } from '../services/gmail';
import { composeDigest } from '../services/digest';
import { composeDigestIntro } from '../services/ai';

import { ensureFreshToken } from '../pipeline/shared';

// Default thresholds. Per-user overrides live on the users table (see
// migration 0005) and are read via `user.v2NewsletterThreshold` /
// `user.v2HumanRatingThreshold`.
export const DEFAULT_NEWSLETTER_INTERESTING_THRESHOLD = 6;
export const DEFAULT_HUMAN_RATING_THRESHOLD = 40;

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function past24hWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function firstEmailId(email: Email): string {
  return email.id;
}

async function lookupSenderRating(
  env: Env,
  userId: number,
  email: Email,
): Promise<SenderProfile | null> {
  const sender = await getSenderProfile(env.DB, userId, 'sender', email.fromAddress);
  if (sender) return sender;
  const domain = extractDomain(email.fromAddress);
  return getSenderProfile(env.DB, userId, 'domain', domain);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

async function buildNewsletterSection(
  env: Env,
  userId: number,
  start: string,
  end: string,
  threshold: number,
): Promise<DigestNewsletterItem[]> {
  const emails = await getEmailsByBucket(env.DB, userId, 'newsletter', start, end);
  return emails
    .filter((e) => (e.interestingScore ?? 0) >= threshold)
    .map<DigestNewsletterItem>((e) => ({
      emailId: firstEmailId(e),
      fromAddress: e.fromAddress,
      subject: e.subject,
      interestingScore: e.interestingScore ?? 0,
      reasons: e.interestingReasons ?? [],
      summary: e.summary,
    }));
}

async function buildNotificationSection(
  env: Env,
  userId: number,
  start: string,
  end: string,
): Promise<DigestNotificationItem[]> {
  const emails = await getEmailsByBucket(env.DB, userId, 'notification', start, end);
  return emails
    .filter((e) => e.bypassedInbox) // archived = low-priority by the processor's logic
    .map<DigestNotificationItem>((e) => ({
      emailId: firstEmailId(e),
      fromAddress: e.fromAddress,
      subject: e.subject,
      severity: e.severity ?? 'low',
      urgency: e.urgency ?? 'low',
      summary: e.summary,
      reasoning: e.reasoning,
    }));
}

async function buildQuietHumansSection(
  env: Env,
  userId: number,
  start: string,
  end: string,
  ratingThreshold: number,
): Promise<DigestQuietHumanItem[]> {
  const emails = await getEmailsByBucket(env.DB, userId, 'human', start, end);
  const out: DigestQuietHumanItem[] = [];
  for (const e of emails) {
    if (!e.bypassedInbox) continue;
    const profile = await lookupSenderRating(env, userId, e);
    const rating = profile?.rating ?? null;
    if (rating === null || rating >= ratingThreshold) continue;
    out.push({
      emailId: firstEmailId(e),
      fromAddress: e.fromAddress,
      subject: e.subject,
      rating,
      ratingReasoning: profile?.ratingReasoning ?? '',
      summary: e.summary,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function runDailyDigest(env: Env, userId: number): Promise<void> {
  const user = await getUserByID(env.DB, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  if (!user.isActive) {
    console.log(`[${user.email}] daily-digest: user inactive`);
    return;
  }

  const { start, end } = past24hWindow();
  const digestDate = ymd(new Date());

  const [newsletters, notifications, quietHumans] = await Promise.all([
    buildNewsletterSection(env, user.id, start, end, user.v2NewsletterThreshold),
    buildNotificationSection(env, user.id, start, end),
    buildQuietHumansSection(env, user.id, start, end, user.v2HumanRatingThreshold),
  ]);

  const sections: DigestSections = { newsletters, notifications, quietHumans };

  const totalItems = newsletters.length + notifications.length + quietHumans.length;
  if (totalItems === 0) {
    console.log(`[${user.email}] daily-digest: no items for ${digestDate}, skipping send`);
    return;
  }

  let intro = '';
  try {
    intro = await composeDigestIntro(env, {
      newsletterCount: newsletters.length,
      notificationCount: notifications.length,
      quietHumanCount: quietHumans.length,
    });
  } catch (err) {
    console.error(`[${user.email}] daily-digest: intro generation failed, using fallback:`, err);
    intro = `You have ${totalItems} item${totalItems === 1 ? '' : 's'} to glance at from the last 24 hours.`;
  }

  const composed = composeDigest({ digestDate, intro, sections });
  const subject = `Daily digest - ${digestDate}`;

  let sentAt: string | null = null;
  let gmailMessageId: string | null = null;
  try {
    const accessToken = await ensureFreshToken(env, user);
    const result = await sendHtmlMessage(accessToken, {
      to: user.email,
      subject,
      textBody: composed.text,
      htmlBody: composed.html,
    });
    sentAt = new Date().toISOString();
    gmailMessageId = result.id;
    console.log(`[${user.email}] daily-digest: sent ${result.id} (${totalItems} items)`);
  } catch (err) {
    console.error(`[${user.email}] daily-digest: send failed:`, err);
    // Persist anyway so the UI can show what would have been sent.
  }

  await upsertDigest(env.DB, {
    userId: user.id,
    digestDate,
    contentHtml: composed.html,
    contentText: composed.text,
    sections,
    itemCounts: composed.itemCounts,
    sentAt,
    gmailMessageId,
  });

  // Mark the emails so the UI can show they were digested.
  const ids: string[] = [
    ...newsletters.map((i) => i.emailId),
    ...notifications.map((i) => i.emailId),
    ...quietHumans.map((i) => i.emailId),
  ];
  await markIncludedInDigest(env.DB, ids, digestDate);
}
