// ============================================================================
// services/ai.ts — stage-specific AI wrappers for the v2 pipeline
// ----------------------------------------------------------------------------
// Each public function here corresponds to one stage in the multi-stage email
// pipeline. They all use the shared OpenAI chat completion + structured
// output plumbing from services/openai.ts.
//
// Per-stage model selection is resolved from the Env — `resolveStageModel`
// picks `OPENAI_MODEL_<STAGE>` with a fallback to `OPENAI_MODEL`. This keeps
// model choice a deploy-time decision (wrangler.toml vars) rather than a
// code change.
//
// The v1 processor still lives in services/openai.ts and is unchanged — this
// file is additive. Once v2 is confirmed in prod, the v1-specific exports
// (analyzeEmail, determineActions, bootstrapSenderProfile, etc.) can be
// deleted.
// ============================================================================

import type { Env } from '../types/env';
import type { Bucket } from '../types/models';
import {
  chatCompletion,
  structuredFormat,
  type OpenAIConfig,
} from './openai';

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

export type Stage =
  | 'triage'
  | 'newsletter'
  | 'notification'
  | 'human'
  | 'transactional'
  | 'security'
  | 'calendar'
  | 'summary'
  | 'sender_rating';

export function resolveStageModel(env: Env, stage: Stage): string {
  switch (stage) {
    case 'triage': return env.OPENAI_MODEL_TRIAGE ?? env.OPENAI_MODEL;
    case 'newsletter': return env.OPENAI_MODEL_NEWSLETTER ?? env.OPENAI_MODEL;
    case 'notification': return env.OPENAI_MODEL_NOTIFICATION ?? env.OPENAI_MODEL;
    case 'human': return env.OPENAI_MODEL_HUMAN ?? env.OPENAI_MODEL;
    case 'transactional': return env.OPENAI_MODEL_TRANSACTIONAL ?? env.OPENAI_MODEL;
    case 'security': return env.OPENAI_MODEL_SECURITY ?? env.OPENAI_MODEL;
    case 'calendar': return env.OPENAI_MODEL_CALENDAR ?? env.OPENAI_MODEL;
    case 'summary': return env.OPENAI_MODEL_SUMMARY ?? env.OPENAI_MODEL;
    case 'sender_rating': return env.OPENAI_MODEL_SENDER_RATING ?? env.OPENAI_MODEL;
  }
}

export function aiConfig(env: Env, stage: Stage): OpenAIConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    model: resolveStageModel(env, stage),
  };
}

// ---------------------------------------------------------------------------
// Result types — one per stage
// ---------------------------------------------------------------------------

export interface TriageResult {
  bucket: Bucket;
  confidence: number;   // 0..1
  reasoning: string;
}

export interface NewsletterResult {
  slug: string;
  summary: string;
  keywords: string[];
  interesting_score: number;    // 0..10
  interesting_reasons: string[];
}

export interface NotificationResult {
  slug: string;
  summary: string;
  keywords: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  urgency: 'low' | 'medium' | 'high';
  action_required: boolean;
  notification_message: string; // '' when no alert needed
  reasoning: string;
}

export interface HumanResult {
  slug: string;
  summary: string;
  keywords: string[];
  labels: string[];
  notification_message: string;
  draft_reply: boolean;
  reasoning: string;
}

export interface TransactionalResult {
  slug: string;
  summary: string;
  keywords: string[];
  vendor: string;
  document_type: string;        // receipt | invoice | shipping | order | booking | other
  amount: string;               // currency + value, or ''
  labels: string[];
  reasoning: string;
}

export interface SecurityResult {
  slug: string;
  summary: string;
  keywords: string[];
  action_type: string;          // mfa | reset | login_alert | account_recovery | other
  is_otp: boolean;
  notification_message: string;
  reasoning: string;
}

export interface CalendarResult {
  slug: string;
  summary: string;
  keywords: string[];
  event_title: string;
  starts_at: string;            // ISO or ''
  ends_at: string;
  location: string;
  attendees: string[];
  notification_message: string;
  reasoning: string;
}

export interface SenderRatingResult {
  rating: number;               // 0..99
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Stage 1 — Triage
// ---------------------------------------------------------------------------

const BUCKETS_ENUM = [
  'newsletter',
  'notification',
  'human',
  'transactional',
  'security',
  'calendar',
] as const;

const BUCKET_DEFINITIONS = `Buckets:
- newsletter: recurring marketing/content emails — Substacks, product
  announcements, promotional campaigns. Usually unsolicited in the sense
  that the user didn't just trigger them.
- notification: automated alerts triggered by external activity —
  monitoring alerts, PR comments, social mentions, system status.
- human: a message written by a real person to the user, or a mailing
  list thread with actual human participation.
- transactional: triggered by a user action — order confirmations,
  receipts, invoices, shipping updates, booking confirmations.
- security: MFA codes, password resets, login alerts, account recovery.
  Safety-critical even if automated.
- calendar: meeting invites, calendar updates, cancellations.`;

export async function triageEmail(
  env: Env,
  params: {
    from: string;
    subject: string;
    bodySample: string;
    senderContext: string;
  },
): Promise<TriageResult> {
  const systemPrompt = `You classify emails into one of six buckets so the
right automation can process them. Be decisive; pick the single best
bucket. If an email could fit two buckets, pick the one that determines
how the user should act on it (security > calendar > human >
transactional > notification > newsletter).

${BUCKET_DEFINITIONS}

Return JSON: {bucket, confidence (0..1), reasoning (1 sentence)}.`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext ? params.senderContext + '\n' : ''}Body sample:
${params.bodySample}`;

  const content = await chatCompletion(aiConfig(env, 'triage'), {
    model: resolveStageModel(env, 'triage'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 2000,
    response_format: structuredFormat('triage_result', 'Email triage classification', {
      type: 'object',
      properties: {
        bucket: { type: 'string', enum: BUCKETS_ENUM as unknown as string[] },
        confidence: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['bucket', 'confidence', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as TriageResult;
}

// ---------------------------------------------------------------------------
// Stage 2 — Newsletter
// ---------------------------------------------------------------------------

export async function processNewsletter(
  env: Env,
  params: {
    from: string;
    subject: string;
    body: string;
    senderContext: string;
    memoryContext: string;
    userSystemPrompt: string;
  },
): Promise<NewsletterResult> {
  const systemPrompt = (params.userSystemPrompt || `You process newsletter
emails. Score each for how likely it is to be worth the user's time.`) +
`

Produce:
- slug: snake_case email type (e.g. "substack_weekly", "vendor_product_update")
- summary: one-line summary (<=120 chars)
- keywords: 3-5 descriptive keywords
- interesting_score: 0-10. 0 = pure marketing/generic filler. 10 = novel
  insight directly aligned with the user's stated interests. Default to 3
  unless you have a real reason to score higher.
- interesting_reasons: short bullet-style reasons backing the score (max 3)`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext}${params.memoryContext}Body:
${params.body}`;

  const content = await chatCompletion(aiConfig(env, 'newsletter'), {
    model: resolveStageModel(env, 'newsletter'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 4000,
    response_format: structuredFormat('newsletter_result', 'Newsletter processing result', {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        interesting_score: { type: 'number' },
        interesting_reasons: { type: 'array', items: { type: 'string' } },
      },
      required: ['slug', 'summary', 'keywords', 'interesting_score', 'interesting_reasons'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as NewsletterResult;
}

// ---------------------------------------------------------------------------
// Stage 2 — Notification
// ---------------------------------------------------------------------------

export async function processNotification(
  env: Env,
  params: {
    from: string;
    subject: string;
    body: string;
    senderContext: string;
    memoryContext: string;
    userSystemPrompt: string;
  },
): Promise<NotificationResult> {
  const systemPrompt = (params.userSystemPrompt || `You assess automated
notifications for severity and urgency.`) +
`

Produce:
- slug: snake_case notification type
- summary: one line (<=120 chars)
- keywords: 3-5
- severity: low | medium | high | critical — what's at stake?
- urgency: low | medium | high — how soon does the user need to react?
- action_required: true only when the user must do something specific
- notification_message: '' unless severity>=high OR urgency>=high; when
  set, a short friendly message for a push notification
- reasoning: 1-2 sentences backing the above`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext}${params.memoryContext}Body:
${params.body}`;

  const content = await chatCompletion(aiConfig(env, 'notification'), {
    model: resolveStageModel(env, 'notification'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 4000,
    response_format: structuredFormat('notification_result', 'Notification processing result', {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        urgency: { type: 'string', enum: ['low', 'medium', 'high'] },
        action_required: { type: 'boolean' },
        notification_message: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['slug', 'summary', 'keywords', 'severity', 'urgency',
                 'action_required', 'notification_message', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as NotificationResult;
}

// ---------------------------------------------------------------------------
// Stage 2 — Human
// ---------------------------------------------------------------------------

export async function processHuman(
  env: Env,
  params: {
    from: string;
    subject: string;
    body: string;
    labelsFormatted: string;
    labelNames: string[];
    senderContext: string;
    memoryContext: string;
    senderRating: number | null;
    userSystemPrompt: string;
  },
): Promise<HumanResult> {
  const ratingContext = params.senderRating !== null
    ? `\nSender rating: ${params.senderRating}/100. Below 40 = low-priority;
treat as archivable unless content overrides that.`
    : '\nSender has no rating yet — default to keeping in inbox.';

  const systemPrompt = (params.userSystemPrompt || `You process human
emails to the user.`) + ratingContext + `

Available labels:
${params.labelsFormatted}

Produce:
- slug: snake_case (e.g. "work_colleague", "family_update", "sales_outreach")
- summary: one line (<=120 chars)
- keywords: 3-5
- labels: array of exact label names from the list above, only if they
  clearly match
- notification_message: '' unless this is time-sensitive and from a
  high-priority sender; when set, a short friendly message
- draft_reply: true only when the sender expects a response and the
  content gives you enough to draft one
- reasoning: 1 sentence`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext}${params.memoryContext}Body:
${params.body}`;

  const content = await chatCompletion(aiConfig(env, 'human'), {
    model: resolveStageModel(env, 'human'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 4000,
    response_format: structuredFormat('human_result', 'Human email processing result', {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        labels: {
          type: 'array',
          items: params.labelNames.length > 0
            ? { type: 'string', enum: params.labelNames }
            : { type: 'string' },
        },
        notification_message: { type: 'string' },
        draft_reply: { type: 'boolean' },
        reasoning: { type: 'string' },
      },
      required: ['slug', 'summary', 'keywords', 'labels',
                 'notification_message', 'draft_reply', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as HumanResult;
}

// ---------------------------------------------------------------------------
// Stage 2 — Transactional
// ---------------------------------------------------------------------------

export async function processTransactional(
  env: Env,
  params: {
    from: string;
    subject: string;
    body: string;
    senderContext: string;
    userSystemPrompt: string;
  },
): Promise<TransactionalResult> {
  const systemPrompt = (params.userSystemPrompt || `You process
transactional emails — receipts, invoices, order/shipping confirmations,
bookings.`) + `

Produce:
- slug: snake_case (e.g. "order_confirmation", "invoice", "shipping_update")
- summary: one line (<=120 chars)
- keywords: 3-5
- vendor: short vendor name (e.g. "Amazon", "Stripe"). '' if unknown.
- document_type: receipt | invoice | shipping | order | booking | refund | other
- amount: '$123.45' or 'AU$12.00' or '' if no amount
- labels: suggested labels to apply (e.g. "transactional/amazon").
  Include one timed label: "🗑️/1m" for receipts/shipping; "📥/1y" for
  invoices or anything tax-relevant.
- reasoning: 1 sentence`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext}Body:
${params.body}`;

  const content = await chatCompletion(aiConfig(env, 'transactional'), {
    model: resolveStageModel(env, 'transactional'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 3000,
    response_format: structuredFormat('transactional_result', 'Transactional email processing result', {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        vendor: { type: 'string' },
        document_type: { type: 'string' },
        amount: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        reasoning: { type: 'string' },
      },
      required: ['slug', 'summary', 'keywords', 'vendor', 'document_type',
                 'amount', 'labels', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as TransactionalResult;
}

// ---------------------------------------------------------------------------
// Stage 2 — Security
// ---------------------------------------------------------------------------

export async function processSecurity(
  env: Env,
  params: {
    from: string;
    subject: string;
    body: string;
    senderContext: string;
    userSystemPrompt: string;
  },
): Promise<SecurityResult> {
  const systemPrompt = (params.userSystemPrompt || `You process
security-related emails — MFA codes, password resets, login alerts,
account recovery.`) + `

Produce:
- slug: snake_case (e.g. "mfa_code", "login_alert", "password_reset")
- summary: one line (<=120 chars) — include the OTP code inline if
  present
- keywords: 3-5
- action_type: mfa | reset | login_alert | account_recovery | other
- is_otp: true if this contains a one-time code (short-lived; should be
  deleted quickly)
- notification_message: a concise push-ready message (e.g. "Login code
  123456 for GitHub")
- reasoning: 1 sentence`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext}Body:
${params.body}`;

  const content = await chatCompletion(aiConfig(env, 'security'), {
    model: resolveStageModel(env, 'security'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 2000,
    response_format: structuredFormat('security_result', 'Security email processing result', {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        action_type: { type: 'string' },
        is_otp: { type: 'boolean' },
        notification_message: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['slug', 'summary', 'keywords', 'action_type', 'is_otp',
                 'notification_message', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as SecurityResult;
}

// ---------------------------------------------------------------------------
// Stage 2 — Calendar
// ---------------------------------------------------------------------------

export async function processCalendar(
  env: Env,
  params: {
    from: string;
    subject: string;
    body: string;
    senderContext: string;
    userSystemPrompt: string;
  },
): Promise<CalendarResult> {
  const systemPrompt = (params.userSystemPrompt || `You process calendar
emails — meeting invites, updates, cancellations.`) + `

Produce:
- slug: snake_case (e.g. "meeting_invite", "event_cancellation")
- summary: one line (<=120 chars)
- keywords: 3-5
- event_title: the event's title
- starts_at / ends_at: ISO 8601 timestamps. '' if not specified.
- location: physical location or conference URL. '' if not specified.
- attendees: list of attendee email addresses (max 10)
- notification_message: '' unless the event is within the next hour;
  when set, a short push-ready message
- reasoning: 1 sentence`;

  const userPrompt = `From: ${params.from}
Subject: ${params.subject}

${params.senderContext}Body:
${params.body}`;

  const content = await chatCompletion(aiConfig(env, 'calendar'), {
    model: resolveStageModel(env, 'calendar'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 3000,
    response_format: structuredFormat('calendar_result', 'Calendar email processing result', {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        event_title: { type: 'string' },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        location: { type: 'string' },
        attendees: { type: 'array', items: { type: 'string' } },
        notification_message: { type: 'string' },
        reasoning: { type: 'string' },
      },
      required: ['slug', 'summary', 'keywords', 'event_title', 'starts_at',
                 'ends_at', 'location', 'attendees', 'notification_message',
                 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as CalendarResult;
}

// ---------------------------------------------------------------------------
// Sender rating
// ---------------------------------------------------------------------------

export async function rateSender(
  env: Env,
  params: {
    identifier: string;
    senderType: string;
    aggregatedSignals: string;   // free-form text describing archive rate, reply rate, etc.
  },
): Promise<SenderRatingResult> {
  const systemPrompt = `You rate how likely the user is to want emails from
this sender to reach their inbox, on a 0-99 scale.

Scale:
- 0-19: almost always archive. Pure cold-outreach/sales/spam-adjacent.
- 20-39: low priority. Usually archived.
- 40-59: mixed. Some emails matter.
- 60-79: usually wanted in inbox.
- 80-99: high priority. Personal/critical — always surface.

Base the rating on the aggregated behaviour signals provided. If there's
almost no data, default to 50. Return {rating, reasoning (1-2 sentences)}.`;

  const userPrompt = `Sender: ${params.identifier}
Current sender type classification: ${params.senderType}

Signals:
${params.aggregatedSignals}`;

  const content = await chatCompletion(aiConfig(env, 'sender_rating'), {
    model: resolveStageModel(env, 'sender_rating'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 1500,
    response_format: structuredFormat('sender_rating_result', 'Sender rating result', {
      type: 'object',
      properties: {
        rating: { type: 'number' },
        reasoning: { type: 'string' },
      },
      required: ['rating', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as SenderRatingResult;
}

// ---------------------------------------------------------------------------
// Digest composition
// ---------------------------------------------------------------------------

export async function composeDigestIntro(
  env: Env,
  params: {
    newsletterCount: number;
    notificationCount: number;
    quietHumanCount: number;
  },
): Promise<string> {
  if (params.newsletterCount + params.notificationCount + params.quietHumanCount === 0) {
    return 'Nothing notable in your inbox today.';
  }
  const systemPrompt = `You write the 1-2 sentence intro for a daily email
digest. Tone: conversational, concise, not over-the-top cheerful.`;
  const userPrompt = `Today's digest has:
- ${params.newsletterCount} interesting newsletter(s)
- ${params.notificationCount} notification(s) grouped for review
- ${params.quietHumanCount} low-rated human sender email(s) to glance at

Write the intro.`;

  const content = await chatCompletion(aiConfig(env, 'summary'), {
    model: resolveStageModel(env, 'summary'),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 500,
  });
  return content.trim();
}
