import type { Env } from '../types/env';
import type { Email, SenderProfile, ProfileType } from '../types/models';

// DB helpers
import { getUserByID, updateUserToken } from '../db/users';
import { emailExists, createEmail, getHistoricalEmailsFromAddress, getHistoricalEmailsFromDomain } from '../db/emails';
import { getUserLabelsWithDetails } from '../db/labels';
import { getSystemPrompt, getLatestAIPrompt } from '../db/prompts';
import { getRecentMemoriesForContext } from '../db/memories';
import {
  getSenderProfile,
  upsertSenderProfile,
  extractDomain,
  isIgnoredDomain,
  buildProfileFromEmails,
  formatProfileForPrompt,
} from '../db/sender-profiles';
import { createNotification } from '../db/notifications';

// Service clients
import { getMessage, refreshAccessToken } from '../services/gmail';
import type { OpenAIConfig, EmailAnalysis, EmailActions } from '../services/openai';
import {
  analyzeEmail,
  determineActions,
  bootstrapSenderProfile,
  evolveProfileSummary,
} from '../services/openai';
import { sendPushover } from '../services/pushover';
import { sendWebhook } from '../services/webhook';
import type { WebhookPayload } from '../services/webhook';

// Pipeline actions
import { applyLabelsAndArchive } from './actions';

// ---------------------------------------------------------------------------
// Main pipeline entry point
// ---------------------------------------------------------------------------

/**
 * Process a single email through the two-stage AI pipeline.
 * This is the queue consumer handler — it mirrors ProcessEmail from the Go
 * codebase line-for-line.
 */
export async function processEmail(env: Env, userId: number, messageId: string): Promise<void> {
  // 1. Get user
  const user = await getUserByID(env.DB, userId);
  if (!user) {
    throw new Error(`user ${userId} not found`);
  }

  console.log(`[${user.email}] Processing email: ${messageId}`);

  // 2. Dedup check
  const exists = await emailExists(env.DB, messageId);
  if (exists) {
    console.log(`[${user.email}] Skipping already processed email: ${messageId}`);
    return;
  }

  // 3. Refresh OAuth token if expired
  let accessToken = user.accessToken;
  const tokenExpiry = new Date(user.tokenExpiry);
  if (tokenExpiry.getTime() <= Date.now()) {
    const refreshed = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      user.refreshToken,
    );
    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await updateUserToken(env.DB, user.id, accessToken, user.refreshToken, newExpiry);
  }

  // 4. Fetch full email from Gmail
  const message = await getMessage(accessToken, messageId);

  // 5. Truncate body (Gmail client already base64-decodes)
  let body = message.body;
  if (body.length > 2000) {
    body = body.slice(0, 2000) + '...';
  }

  // 6. Load system prompts (both optional)
  let analyzePrompt = '';
  let actionsPrompt = '';

  const analyzeSystemPrompt = await getSystemPrompt(env.DB, user.id, 'email_analyze');
  if (analyzeSystemPrompt) {
    analyzePrompt = analyzeSystemPrompt.content;
  }
  const actionsSystemPrompt = await getSystemPrompt(env.DB, user.id, 'email_actions');
  if (actionsSystemPrompt) {
    actionsPrompt = actionsSystemPrompt.content;
  }

  // 7. Append AI-generated prompt supplements
  const aiAnalyzePrompt = await getLatestAIPrompt(env.DB, user.id, 'email_analyze');
  if (aiAnalyzePrompt) {
    if (analyzePrompt) {
      analyzePrompt += '\n\n' + aiAnalyzePrompt.content;
    } else {
      analyzePrompt = aiAnalyzePrompt.content;
    }
  }
  const aiActionsPrompt = await getLatestAIPrompt(env.DB, user.id, 'email_actions');
  if (aiActionsPrompt) {
    if (actionsPrompt) {
      actionsPrompt += '\n\n' + aiActionsPrompt.content;
    } else {
      actionsPrompt = aiActionsPrompt.content;
    }
  }

  // 8. Load memories for context
  let memoryContext = '';
  const memories = await getRecentMemoriesForContext(env.DB, user.id);
  if (memories.length > 0) {
    memoryContext = 'Past learnings from email processing:\n\n';
    for (const mem of memories) {
      memoryContext += `**${mem.type.toUpperCase()} Memory:**\n${mem.content}\n\n`;
    }
  }

  // 9. Load / bootstrap sender profiles
  const domain = extractDomain(message.from);

  const senderProfile = await loadOrBootstrapProfile(
    env, user.id, 'sender', message.from, domain,
  );
  let domainProfile: SenderProfile | null = null;
  if (!isIgnoredDomain(domain)) {
    domainProfile = await loadOrBootstrapProfile(
      env, user.id, 'domain', domain, domain,
    );
  }
  const senderContext = formatProfilesForPrompt(senderProfile, domainProfile);

  // Build OpenAI config from env
  const openaiConfig: OpenAIConfig = {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  };

  // 10. Stage 1: Analyze email
  const analysis = await analyzeEmail(
    openaiConfig, message.from, message.subject, body, senderContext, analyzePrompt,
  );
  console.log(`[${user.email}] Stage 1 - Slug: ${analysis.slug}, Keywords: ${JSON.stringify(analysis.keywords)}`);

  // 11. Stage 2: Determine actions
  const labelDetails = await getUserLabelsWithDetails(env.DB, user.id);

  const labelNames: string[] = [];
  const labelLines: string[] = [];
  for (const l of labelDetails) {
    labelNames.push(l.name);
    let line = `- "${l.name}"`;
    if (l.description) {
      line += ': ' + l.description;
    }
    if (l.reasons.length > 0) {
      line += ' (e.g. ' + l.reasons.join(', ') + ')';
    }
    labelLines.push(line);
  }
  const formattedLabels = labelLines.join('\n');

  const actions = await determineActions(
    openaiConfig,
    message.from,
    message.subject,
    analysis.slug,
    analysis.keywords,
    analysis.summary,
    labelNames,
    formattedLabels,
    senderContext,
    memoryContext,
    actionsPrompt,
  );
  console.log(`[${user.email}] Stage 2 - Labels: ${JSON.stringify(actions.labels)}, Bypass: ${actions.bypass_inbox}, Reason: ${actions.reasoning}`);

  // 12. Send Pushover notification
  let notificationSent = false;
  if (actions.notification_message && user.pushoverUserKey && user.pushoverAppToken) {
    try {
      await sendPushover(user.pushoverUserKey, user.pushoverAppToken, message.subject, actions.notification_message);
      notificationSent = true;
      console.log(`[${user.email}] Push notification sent for: ${message.subject}`);

      // Persist notification
      try {
        await createNotification(env.DB, {
          userId: user.id,
          emailId: messageId,
          fromAddress: message.from,
          subject: message.subject,
          message: actions.notification_message,
          sentAt: new Date().toISOString(),
        });
      } catch (err) {
        console.log(`[${user.email}] Failed to save notification: ${err}`);
      }
    } catch (err) {
      console.log(`[${user.email}] Failed to send push notification: ${err}`);
    }
  }

  // 13. Send webhook notification
  if (actions.notification_message && user.webhookUrl) {
    try {
      const payload: WebhookPayload = {
        title: message.subject,
        message: actions.notification_message,
        from_address: message.from,
        email_id: messageId,
        slug: analysis.slug,
        subject: message.subject,
        labels_applied: actions.labels,
        processed_at: new Date().toISOString(),
      };
      await sendWebhook(user.webhookUrl, user.webhookHeaderKey, user.webhookHeaderValue, payload);
      console.log(`[${user.email}] Webhook notification sent for: ${message.subject}`);

      // Persist notification if not already saved by Pushover
      if (!notificationSent) {
        try {
          await createNotification(env.DB, {
            userId: user.id,
            emailId: messageId,
            fromAddress: message.from,
            subject: message.subject,
            message: actions.notification_message,
            sentAt: new Date().toISOString(),
          });
        } catch (err) {
          console.log(`[${user.email}] Failed to save notification: ${err}`);
        }
      }
      notificationSent = true;
    } catch (err) {
      console.log(`[${user.email}] Failed to send webhook notification: ${err}`);
    }
  }

  // 14. Save email to D1
  const now = new Date().toISOString();
  const email: Email = {
    id: messageId,
    userId: user.id,
    fromAddress: message.from,
    fromDomain: domain,
    subject: message.subject,
    slug: analysis.slug,
    keywords: analysis.keywords,
    summary: analysis.summary,
    labelsApplied: actions.labels,
    bypassedInbox: actions.bypass_inbox,
    reasoning: actions.reasoning,
    humanFeedback: '',
    feedbackDirty: false,
    notificationSent,
    processedAt: now,
    createdAt: now,
  };
  await createEmail(env.DB, email);

  // 15. Apply to Gmail (non-critical)
  try {
    await applyLabelsAndArchive(accessToken, messageId, actions.labels, actions.bypass_inbox);
  } catch (err) {
    console.log(`[${user.email}] Error applying actions to Gmail: ${err}`);
  }

  // 16. Update sender profiles (non-critical)
  if (senderProfile) {
    try {
      await updateProfileAfterProcessing(env, senderProfile, analysis, actions);
    } catch (err) {
      console.log(`[${user.email}] Error updating sender profile: ${err}`);
    }
  }
  if (domainProfile) {
    try {
      await updateProfileAfterProcessing(env, domainProfile, analysis, actions);
    } catch (err) {
      console.log(`[${user.email}] Error updating domain profile: ${err}`);
    }
  }

  console.log(`[${user.email}] Email processed successfully: ${message.subject}`);
}

// ---------------------------------------------------------------------------
// Helper: load or bootstrap a sender/domain profile
// ---------------------------------------------------------------------------

async function loadOrBootstrapProfile(
  env: Env,
  userId: number,
  profileType: ProfileType,
  identifier: string,
  domain: string,
): Promise<SenderProfile | null> {
  try {
    const profile = await getSenderProfile(env.DB, userId, profileType, identifier);
    if (profile) return profile;
  } catch (err) {
    console.log(`Error loading ${profileType} profile for ${identifier}: ${err}`);
    return null;
  }

  return bootstrapProfile(env, userId, profileType, identifier, domain);
}

async function bootstrapProfile(
  env: Env,
  userId: number,
  profileType: ProfileType,
  identifier: string,
  _domain: string,
): Promise<SenderProfile | null> {
  let emails: Email[];
  try {
    if (profileType === 'sender') {
      emails = await getHistoricalEmailsFromAddress(env.DB, userId, identifier, 25);
    } else {
      emails = await getHistoricalEmailsFromDomain(env.DB, userId, identifier, 25);
    }
  } catch (err) {
    console.log(`Error getting historical emails for ${profileType} profile ${identifier}: ${err}`);
    return null;
  }

  // Build profile from historical data
  const profile = buildProfileFromEmails(userId, profileType, identifier, emails);

  // If we have history, use AI to classify and summarize
  if (emails.length > 0) {
    try {
      const openaiConfig: OpenAIConfig = {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL,
        baseUrl: env.OPENAI_BASE_URL,
      };
      const emailSummaries = emails
        .map((e) => `- Subject: ${e.subject} | Slug: ${e.slug} | Labels: ${e.labelsApplied.join(', ')}`)
        .join('\n');
      const result = await bootstrapSenderProfile(openaiConfig, identifier, emailSummaries);
      profile.senderType = result.sender_type;
      profile.summary = result.summary;
    } catch (err) {
      console.log(`Error bootstrapping ${profileType} profile for ${identifier}: ${err}`);
    }
  }

  // Save the profile
  try {
    await upsertSenderProfile(env.DB, profile);
  } catch (err) {
    console.log(`Error saving bootstrapped ${profileType} profile for ${identifier}: ${err}`);
    return null;
  }

  console.log(`Bootstrapped ${profileType} profile for ${identifier} (emails: ${emails.length})`);
  return profile;
}

// ---------------------------------------------------------------------------
// Helper: update profile after processing an email
// ---------------------------------------------------------------------------

async function updateProfileAfterProcessing(
  env: Env,
  profile: SenderProfile,
  analysis: EmailAnalysis,
  actions: EmailActions,
): Promise<void> {
  profile.emailCount++;
  profile.lastSeenAt = new Date().toISOString();

  if (analysis.slug) {
    profile.slugCounts[analysis.slug] = (profile.slugCounts[analysis.slug] ?? 0) + 1;
  }
  for (const label of actions.labels) {
    profile.labelCounts[label] = (profile.labelCounts[label] ?? 0) + 1;
  }
  for (const kw of analysis.keywords) {
    profile.keywordCounts[kw] = (profile.keywordCounts[kw] ?? 0) + 1;
  }
  if (actions.bypass_inbox) {
    profile.emailsArchived++;
  }
  if (actions.notification_message) {
    profile.emailsNotified++;
  }

  // Evolve summary via AI
  const openaiConfig: OpenAIConfig = {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  };

  const updateContext = `New email processed:
From: ${profile.identifier}
Subject: ${analysis.summary}
Slug: ${analysis.slug}
Keywords: ${JSON.stringify(analysis.keywords)}
Labels applied: ${JSON.stringify(actions.labels)}
Archived: ${actions.bypass_inbox}
Notified: ${actions.notification_message !== ''}
Summary: ${analysis.summary}`;

  try {
    const result = await evolveProfileSummary(
      openaiConfig,
      profile.summary,
      profile.senderType,
      updateContext,
    );
    profile.senderType = result.sender_type;
    profile.summary = result.summary;
  } catch (err) {
    console.log(`Error evolving ${profile.profileType} profile summary for ${profile.identifier}: ${err}`);
  }

  await upsertSenderProfile(env.DB, profile);
}

// ---------------------------------------------------------------------------
// Helper: format sender + domain profiles for AI prompt context
// ---------------------------------------------------------------------------

function formatProfilesForPrompt(
  sender: SenderProfile | null,
  domain: SenderProfile | null,
): string {
  if (!sender && !domain) return '';

  let result = '';
  if (sender && sender.emailCount > 0) {
    result += `**Sender Profile** (${sender.identifier}):\n${formatProfileForPrompt(sender)}\n`;
  }
  if (domain && domain.emailCount > 0) {
    result += `**Domain Profile** (${domain.identifier}):\n${formatProfileForPrompt(domain)}\n`;
  }
  return result;
}
