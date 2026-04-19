// ============================================================================
// Bucket processor scaffold — common plumbing for all six stage-2 processors.
// ----------------------------------------------------------------------------
// Each bucket's file supplies a `BucketProcessor` function. This module
// handles the boilerplate around it: loading the user/message/profile/prompts,
// applying the returned labels + archive/draft/notification actions to Gmail,
// persisting the email row, and updating sender profile stats.
// ============================================================================

import type { Env } from '../../types/env';
import type {
  Bucket,
  Email,
  SenderProfile,
  User,
} from '../../types/models';

import { getUserByID } from '../../db/users';
import { finaliseEmail, getEmailByID } from '../../db/emails';
import { createNotification } from '../../db/notifications';
import {
  formatProfileForPrompt,
  upsertSenderProfile,
} from '../../db/sender-profiles';
import {
  getLatestAIPrompt,
  getSystemPrompt,
} from '../../db/prompts';
import { getRecentMemoriesForContext } from '../../db/memories';

import {
  createDraft,
  getMessage,
  type GmailMessage,
} from '../../services/gmail';
import { sendPushover } from '../../services/pushover';
import { sendWebhook, type WebhookPayload } from '../../services/webhook';

import { applyLabelsAndArchive } from '../actions';
import {
  ensureFreshToken,
  loadSenderAndDomainProfiles,
} from '../shared';

export interface BucketContext {
  env: Env;
  user: User;
  accessToken: string;
  gmailMsg: GmailMessage;
  emailStub: Email;
  senderProfile: SenderProfile | null;
  domainProfile: SenderProfile | null;
  senderContext: string;
  memoryContext: string;
  userSystemPrompt: string;
}

export interface BucketOutcome {
  slug: string;
  summary: string;
  keywords: string[];
  labels: string[];
  bypassInbox: boolean;
  notificationMessage: string;
  /** Body of draft reply. Empty string = no draft. */
  draftBody: string;
  severity?: string | null;
  urgency?: string | null;
  interestingScore?: number | null;
  interestingReasons?: string[];
  // Bucket-specific extractions (newsletter + notification already use
  // fields above; transactional/security/calendar use these).
  vendor?: string | null;
  documentType?: string | null;
  amount?: string | null;
  actionType?: string | null;
  isOtp?: boolean | null;
  eventTitle?: string | null;
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
  eventLocation?: string | null;
  eventAttendees?: string[];
  reasoning: string;
}

export type BucketProcessor = (ctx: BucketContext) => Promise<BucketOutcome>;

// ---------------------------------------------------------------------------
// Shared pipeline runner
// ---------------------------------------------------------------------------

/** Truncate body for stage-2 prompts; full fidelity isn't needed. */
function truncateForProcessor(body: string, maxChars = 3000): string {
  return body.length <= maxChars ? body : body.slice(0, maxChars) + '…';
}

/**
 * Build the combined system prompt for a bucket stage. Layers user-defined
 * prompt + AI-evolved prompt on top of each other, identical to the v1
 * convention. The human bucket reuses the existing 'email_actions' slot;
 * other buckets default to empty so the built-in prompts in services/ai.ts
 * apply. Bucket-specific user prompt slots can be added later without
 * changing the v2 wiring.
 */
async function loadUserSystemPrompt(
  env: Env,
  userId: number,
  bucket: Bucket,
): Promise<string> {
  if (bucket !== 'human') return '';

  let prompt = '';
  const userPrompt = await getSystemPrompt(env.DB, userId, 'email_actions');
  if (userPrompt) prompt = userPrompt.content;

  const aiPrompt = await getLatestAIPrompt(env.DB, userId, 'email_actions');
  if (aiPrompt) {
    prompt = prompt ? prompt + '\n\n' + aiPrompt.content : aiPrompt.content;
  }
  return prompt;
}

async function loadMemoryContext(env: Env, userId: number): Promise<string> {
  const memories = await getRecentMemoriesForContext(env.DB, userId);
  if (memories.length === 0) return '';
  let text = 'Past learnings from email processing:\n\n';
  for (const m of memories) {
    text += `**${m.type.toUpperCase()} Memory:**\n${m.content}\n\n`;
  }
  return text;
}

function formatSenderContext(
  sender: SenderProfile | null,
  domain: SenderProfile | null,
): string {
  if (!sender && !domain) return '';
  let text = '';
  if (sender && sender.emailCount > 0) {
    text += `**Sender Profile** (${sender.identifier}):\n${formatProfileForPrompt(sender)}\n`;
  }
  if (domain && domain.emailCount > 0) {
    text += `**Domain Profile** (${domain.identifier}):\n${formatProfileForPrompt(domain)}\n`;
  }
  return text;
}

/**
 * Run a bucket processor end-to-end. This is the entry point called from the
 * queue consumer for each bucket.
 */
export async function runBucketProcessor(
  env: Env,
  bucket: Bucket,
  userId: number,
  messageId: string,
  processor: BucketProcessor,
): Promise<void> {
  const user = await getUserByID(env.DB, userId);
  if (!user) throw new Error(`user ${userId} not found`);

  const emailStub = await getEmailByID(env.DB, messageId);
  if (!emailStub) {
    console.warn(`[${user.email}] ${bucket}: email stub missing for ${messageId} — triage must run first`);
    return;
  }
  if (emailStub.pipelineStage === 'processed') {
    console.log(`[${user.email}] ${bucket}: already processed ${messageId}, skipping`);
    return;
  }

  const accessToken = await ensureFreshToken(env, user);
  const gmailMsg = await getMessage(accessToken, messageId);

  const { sender, domain } = await loadSenderAndDomainProfiles(env, user.id, emailStub.fromAddress);

  const [memoryContext, userSystemPrompt] = await Promise.all([
    loadMemoryContext(env, user.id),
    loadUserSystemPrompt(env, user.id, bucket),
  ]);

  const ctx: BucketContext = {
    env,
    user,
    accessToken,
    gmailMsg: { ...gmailMsg, body: truncateForProcessor(gmailMsg.body) },
    emailStub,
    senderProfile: sender,
    domainProfile: domain,
    senderContext: formatSenderContext(sender, domain),
    memoryContext,
    userSystemPrompt,
  };

  const outcome = await processor(ctx);
  console.log(
    `[${user.email}] ${bucket}: processed ${messageId} — ` +
    `labels=${JSON.stringify(outcome.labels)} bypass=${outcome.bypassInbox} ` +
    `notify=${outcome.notificationMessage ? 'yes' : 'no'} draft=${outcome.draftBody ? 'yes' : 'no'}`,
  );

  // ---- Apply to Gmail (non-critical) ----
  try {
    await applyLabelsAndArchive(accessToken, messageId, outcome.labels, outcome.bypassInbox);
  } catch (err) {
    console.error(`[${user.email}] ${bucket}: Gmail apply failed for ${messageId}:`, err);
  }

  // ---- Pushover + webhook notifications ----
  // Per-bucket opt-out: v2_notify_buckets is a partial map; missing keys
  // default to allowed (true). Explicit `false` suppresses all outbound
  // notifications for this bucket regardless of what the processor decided.
  let notificationSent = false;
  const bucketAllowsNotify = user.v2NotifyBuckets[bucket] !== false;
  if (
    outcome.notificationMessage &&
    bucketAllowsNotify &&
    user.pushoverUserKey &&
    user.pushoverAppToken
  ) {
    try {
      await sendPushover(
        user.pushoverUserKey,
        user.pushoverAppToken,
        gmailMsg.subject,
        outcome.notificationMessage,
      );
      notificationSent = true;
    } catch (err) {
      console.error(`[${user.email}] ${bucket}: pushover failed:`, err);
    }
  }
  if (outcome.notificationMessage && bucketAllowsNotify && user.webhookUrl) {
    try {
      const payload: WebhookPayload = {
        title: gmailMsg.subject,
        message: outcome.notificationMessage,
        from_address: gmailMsg.from,
        email_id: messageId,
        slug: outcome.slug,
        subject: gmailMsg.subject,
        labels_applied: outcome.labels,
        processed_at: new Date().toISOString(),
      };
      await sendWebhook(user.webhookUrl, user.webhookHeaderKey, user.webhookHeaderValue, payload);
      notificationSent = true;
    } catch (err) {
      console.error(`[${user.email}] ${bucket}: webhook failed:`, err);
    }
  }
  if (notificationSent) {
    try {
      await createNotification(env.DB, {
        userId: user.id,
        emailId: messageId,
        fromAddress: gmailMsg.from,
        subject: gmailMsg.subject,
        message: outcome.notificationMessage,
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[${user.email}] ${bucket}: save notification failed:`, err);
    }
  }

  // ---- Draft reply ----
  let draftCreated = false;
  if (outcome.draftBody) {
    try {
      await createDraft(accessToken, gmailMsg.threadId, gmailMsg.from, gmailMsg.subject, outcome.draftBody);
      draftCreated = true;
    } catch (err) {
      console.error(`[${user.email}] ${bucket}: draft failed:`, err);
    }
  }

  // ---- Finalise email row ----
  const now = new Date().toISOString();
  const finalised: Email = {
    ...emailStub,
    slug: outcome.slug,
    keywords: outcome.keywords,
    summary: outcome.summary,
    labelsApplied: outcome.labels,
    bypassedInbox: outcome.bypassInbox,
    reasoning: outcome.reasoning,
    notificationSent,
    draftCreated,
    severity: outcome.severity ?? null,
    urgency: outcome.urgency ?? null,
    interestingScore: outcome.interestingScore ?? null,
    interestingReasons: outcome.interestingReasons ?? [],
    vendor: outcome.vendor ?? null,
    documentType: outcome.documentType ?? null,
    amount: outcome.amount ?? null,
    actionType: outcome.actionType ?? null,
    isOtp: outcome.isOtp ?? null,
    eventTitle: outcome.eventTitle ?? null,
    eventStartsAt: outcome.eventStartsAt ?? null,
    eventEndsAt: outcome.eventEndsAt ?? null,
    eventLocation: outcome.eventLocation ?? null,
    eventAttendees: outcome.eventAttendees ?? [],
    pipelineStage: 'processed',
    processedAt: now,
  };
  await finaliseEmail(env.DB, finalised);

  // ---- Update sender + domain profile stats ----
  await updateProfileStats(env, sender, outcome);
  await updateProfileStats(env, domain, outcome);
}

async function updateProfileStats(
  env: Env,
  profile: SenderProfile | null,
  outcome: BucketOutcome,
): Promise<void> {
  if (!profile) return;
  profile.lastSeenAt = new Date().toISOString();
  if (outcome.slug) {
    profile.slugCounts[outcome.slug] = (profile.slugCounts[outcome.slug] ?? 0) + 1;
  }
  for (const label of outcome.labels) {
    profile.labelCounts[label] = (profile.labelCounts[label] ?? 0) + 1;
  }
  for (const kw of outcome.keywords) {
    profile.keywordCounts[kw] = (profile.keywordCounts[kw] ?? 0) + 1;
  }
  if (outcome.bypassInbox) profile.emailsArchived += 1;
  if (outcome.notificationMessage) profile.emailsNotified += 1;
  try {
    await upsertSenderProfile(env.DB, profile);
  } catch (err) {
    console.error(`updateProfileStats: failed to save ${profile.identifier}:`, err);
  }
}
