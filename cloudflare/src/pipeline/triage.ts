// ============================================================================
// Stage 1 — Triage
// ----------------------------------------------------------------------------
// Consumes messages from TRIAGE_QUEUE. For each email:
//   1. Dedup check.
//   2. Fetch Gmail message.
//   3. Thread-reply fast path  → inherit prior bucket, skip AI.
//   4. Consistent-sender fast path → use cached primary_bucket, skip AI.
//   5. AI triage — classify into one of six buckets.
//   6. Create emails row stub (with bucket + triage metadata).
//   7. Update sender profile's bucket_counts + consistency.
//   8. Enqueue onto the matching bucket queue.
// ============================================================================

import type { Env } from '../types/env';
import type { Bucket, TriageVia } from '../types/models';

import { getUserByID } from '../db/users';
import { createEmailStub, emailExists } from '../db/emails';
import { upsertSenderProfile } from '../db/sender-profiles';
import { getMessage, parseAddress } from '../services/gmail';
import { triageEmail } from '../services/ai';

import {
  ensureFreshToken,
  findPriorThreadBucket,
  formatSenderContextShort,
  getBucketQueue,
  loadSenderAndDomainProfiles,
  updateBucketConsistency,
} from './shared';

export interface TriageMessage {
  userId: number;
  messageId: string;
}

export interface BucketMessage {
  userId: number;
  messageId: string;
  bucket: Bucket;
}

/**
 * Trim the body for triage — the full body is fetched later by the bucket
 * processor. Triage just needs enough to guess the category.
 */
function truncateBody(body: string, maxChars = 600): string {
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars) + '…';
}

export async function runTriage(env: Env, userId: number, messageId: string): Promise<void> {
  const user = await getUserByID(env.DB, userId);
  if (!user) throw new Error(`user ${userId} not found`);
  if (!user.isActive) {
    console.log(`[${user.email}] triage: user inactive, skipping ${messageId}`);
    return;
  }

  if (await emailExists(env.DB, messageId)) {
    console.log(`[${user.email}] triage: dedup skip ${messageId}`);
    return;
  }

  const accessToken = await ensureFreshToken(env, user);
  const gmailMsg = await getMessage(accessToken, messageId);
  const fromAddress = parseAddress(gmailMsg.from);
  const { sender, domain } = await loadSenderAndDomainProfiles(env, user.id, fromAddress);

  // ---- Path 1: thread-reply fast path ----
  const priorBucket = await findPriorThreadBucket(env, user.id, gmailMsg.threadId);
  if (priorBucket) {
    console.log(`[${user.email}] triage: thread-reply fast path → ${priorBucket} (${messageId})`);
    await persistAndEnqueue(env, {
      gmailMsg,
      userId: user.id,
      bucket: priorBucket,
      triageReasoning: `inherited from prior email in thread ${gmailMsg.threadId}`,
      triageVia: 'thread_reply',
    });
    // Do not update bucket_counts — thread replies shouldn't skew the
    // sender's consistency (consider the sender's primary behaviour).
    return;
  }

  // ---- Path 2: consistent-sender fast path ----
  if (sender?.bucketConsistency === 'consistent' && sender.primaryBucket) {
    console.log(`[${user.email}] triage: consistent-sender fast path → ${sender.primaryBucket} (${messageId})`);
    await persistAndEnqueue(env, {
      gmailMsg,
      userId: user.id,
      bucket: sender.primaryBucket,
      triageReasoning: `cached primary_bucket for consistent sender ${sender.identifier}`,
      triageVia: 'consistent_sender',
    });
    // Still record the count so we notice if the sender drifts.
    await applyConsistencyUpdate(env, sender, sender.primaryBucket);
    return;
  }

  // ---- Path 3: AI triage ----
  const senderContext = formatSenderContextShort(sender, domain);
  const bodySample = truncateBody(gmailMsg.body);
  const result = await triageEmail(env, {
    from: fromAddress,
    subject: gmailMsg.subject,
    bodySample,
    senderContext,
  });
  console.log(
    `[${user.email}] triage: AI → ${result.bucket} ` +
    `(conf=${result.confidence.toFixed(2)}) ${messageId} — ${result.reasoning}`,
  );

  await persistAndEnqueue(env, {
    gmailMsg,
    userId: user.id,
    bucket: result.bucket,
    triageReasoning: result.reasoning,
    triageVia: 'ai',
  });

  // Bump bucket_counts for sender + domain profile.
  if (sender) await applyConsistencyUpdate(env, sender, result.bucket);
  if (domain) await applyConsistencyUpdate(env, domain, result.bucket);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function persistAndEnqueue(
  env: Env,
  params: {
    gmailMsg: {
      id: string;
      threadId: string;
      subject: string;
      from: string;
      inReplyTo: string | null;
    };
    userId: number;
    bucket: Bucket;
    triageReasoning: string;
    triageVia: TriageVia;
  },
): Promise<void> {
  const fromAddress = parseAddress(params.gmailMsg.from);
  const domain = fromAddress.split('@').pop()?.toLowerCase() ?? '';

  await createEmailStub(env.DB, {
    id: params.gmailMsg.id,
    userId: params.userId,
    fromAddress,
    fromDomain: domain,
    subject: params.gmailMsg.subject,
    bucket: params.bucket,
    triageReasoning: params.triageReasoning,
    triageVia: params.triageVia,
    inReplyTo: params.gmailMsg.inReplyTo,
    threadId: params.gmailMsg.threadId,
  });

  const queue = getBucketQueue(env, params.bucket);
  const msg: BucketMessage = {
    userId: params.userId,
    messageId: params.gmailMsg.id,
    bucket: params.bucket,
  };
  await queue.send(msg);
}

async function applyConsistencyUpdate(
  env: Env,
  profile: import('../types/models').SenderProfile,
  newBucket: Bucket,
): Promise<void> {
  const update = updateBucketConsistency(profile, newBucket);
  profile.bucketCounts = update.bucketCounts;
  profile.bucketConsistency = update.consistency;
  profile.primaryBucket = update.primaryBucket;
  profile.emailCount += 1;
  profile.lastSeenAt = new Date().toISOString();
  await upsertSenderProfile(env.DB, profile);
}
