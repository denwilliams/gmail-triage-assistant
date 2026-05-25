// OpenAI API client using Workers fetch()
// All calls use the Chat Completions endpoint with structured output via response_format.

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

// ---------- Result types ----------

export interface MemoryResult {
  content: string;
  reasoning: string;
}

export interface ProfileResult {
  sender_type: string;
  summary: string;
}

export interface ProfileEvolveResult extends ProfileResult {
  // false when the new email matches the existing pattern and no rewrite is
  // warranted. Callers should leave `profile.summary` alone when this is false.
  summary_changed: boolean;
}

export interface WizardOption {
  value: string;
  label: string;
}

export interface WizardQuestion {
  id: string;
  text: string;
  type: string; // single_select, multi_select, text
  options: WizardOption[];
}

export interface WizardPrompts {
  email_analyze: string;
  email_actions: string;
}

export interface WizardResponse {
  done: boolean;
  message: string;
  questions: WizardQuestion[];
  prompts: WizardPrompts;
}

// ---------- internal helpers ----------

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_completion_tokens?: number;
  response_format?: any;
}

export async function chatCompletion(config: OpenAIConfig, req: ChatCompletionRequest): Promise<string> {
  const url = `${config.baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${body}`);
  }

  const data = (await res.json()) as any;

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from OpenAI');
  }

  const choice = data.choices[0];

  if (choice.message?.refusal) {
    throw new Error(`OpenAI refused request: ${choice.message.refusal}`);
  }

  const content = choice.message?.content;
  if (!content) {
    throw new Error(`Empty content from OpenAI (finish_reason: ${choice.finish_reason})`);
  }

  return content;
}

export function structuredFormat(name: string, description: string, schema: Record<string, any>): any {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      description,
      strict: true,
      schema,
    },
  };
}

// ---------- public API ----------

/**
 * Generate a draft reply to an email.
 * Returns plain text reply body.
 */
export async function generateDraftReply(
  config: OpenAIConfig,
  params: {
    from: string;
    to: string;
    cc: string;
    subject: string;
    body: string;
    senderContext: string;
    customPrompt: string;
    userEmail: string;
    userIdentity: string;
  },
): Promise<string> {
  let systemPrompt = `You are drafting a reply to an email on behalf of the user. Write a natural, professional response that:
- Addresses the key points in the original email that are actually directed
  at the user (see identity block below). Skip questions aimed at other
  recipients in a group thread.
- Is concise and to the point
- Matches a professional but friendly tone
- Does NOT include a subject line — only the body text
- Does NOT include greetings like "Dear..." unless the original email used them
- Ends with a simple sign-off if appropriate

The user will review and edit this draft before sending, so aim for a good starting point rather than a perfect response.

--- About the user (who you're writing AS) ---
Primary email: ${params.userEmail}
${params.userIdentity ? `Identity hints:\n${params.userIdentity}` : 'No additional identity hints provided.'}`;

  if (params.customPrompt) {
    systemPrompt += `\n\nAdditional context about user preferences:\n${params.customPrompt}`;
  }

  if (params.senderContext) {
    systemPrompt += `\n\nSender context:\n${params.senderContext}`;
  }

  const ccLine = params.cc ? `\nCc: ${params.cc}` : '';
  const userPrompt = `From: ${params.from}\nTo: ${params.to}${ccLine}\nSubject: ${params.subject}\n\n${params.body}`;

  return generateText(config, systemPrompt, userPrompt);
}

/**
 * Generate a memory with structured JSON output including reasoning.
 */
export async function generateMemoryWithReasoning(
  config: OpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<MemoryResult> {
  const structuredSystemPrompt =
    systemPrompt +
    `

IMPORTANT: You must respond with a JSON object containing two fields:
- "content": Your memory content (the actual memory text)
- "reasoning": Your editorial reasoning explaining what you considered important, what you dropped, and why you made the decisions you did`;

  const content = await chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: structuredSystemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 20000,
    response_format: structuredFormat('memory_result', 'Memory content with editorial reasoning', {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The actual memory content text',
        },
        reasoning: {
          type: 'string',
          description: 'Editorial reasoning explaining what was considered important, what was dropped, and why',
        },
      },
      required: ['content', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as MemoryResult;
}

/**
 * Generate plain text (for AI prompts, wrapup summaries, etc.).
 */
export async function generateText(
  config: OpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  return chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 20000,
  });
}

/**
 * Bootstrap a sender profile from historical email data.
 * Returns sender_type and summary.
 */
export async function bootstrapSenderProfile(
  config: OpenAIConfig,
  identifier: string,
  emailSummaries: string,
): Promise<ProfileResult> {
  const systemPrompt = `You are writing a durable sender profile that future
triage decisions will rely on. You have THREE sources of information, in
roughly this order of importance:

1. Your own background knowledge about the sender. The identifier may be a
   well-known brand (GitHub, Amazon, Stripe, LinkedIn, Slack, Tidal,
   Substack, etc.) or recognisable from its name (e.g. "Smith Real Estate"
   is almost certainly a real-estate agent; "Jane's Kitchenware" is a
   kitchenware retailer). Use what you know.
2. The local-part and domain of the email address. Strong signals:
   - no-reply@, noreply@, donotreply@, notifications@, newsletter@,
     hello@, info@, support@, alerts@, mailer@, marketing@ → almost
     certainly automated, not a personal correspondent.
   - first.last@, firstname@, or a clearly human-sounding mailbox can
     still be automated — many companies use a person's name on
     transactional or marketing mail. Domain context wins.
   - A personal email address (@gmail.com, @icloud.com, etc.) sending
     branded promotional content is usually a small business / sole
     trader operating from a personal mailbox — still treat as a
     newsletter / transactional sender, not a human correspondent.
   - Humans CAN send out newsletters; weigh content style alongside the
     address.
3. The historical email subjects / slugs / labels supplied below.

Produce a JSON response:
{
  "sender_type": "newsletter|notification|human|transactional|security|calendar|mixed",
  "summary": "2-3 sentence guide for how to treat FUTURE emails from this sender"
}

sender_type values:
- newsletter: regular informational content, digests, promotional or marketing content
- notification: alerts about external activity or events (social media mentions, PR comments, monitoring alerts, flight delays)
- human: personal or professional correspondence from an individual
- transactional: messages triggered by the user's actions (order confirmations, receipts, booking confirmations, invoices)
- security: security-sensitive messages (2FA/OTP codes, password resets, login alerts, account security notices)
- calendar: meeting invites, event reminders, calendar updates
- mixed: sends multiple distinct types (e.g., a domain that sends both newsletters and transactional emails)

Writing the summary:
- It is forward-looking guidance, NOT a recap of recent emails. Read it as
  "when a new email from this sender arrives, here's what to expect and
  how to handle it."
- Lead with what the sender IS (one phrase), then what they typically send,
  then a treatment hint (e.g. "safe to archive", "watch for receipts",
  "high-signal — surface to inbox").
- Do NOT mention "the latest email", "this email", "no change detected",
  "still newsletter", or anything that sounds like a per-message diff.
- Do NOT include identifiers, counts, or stats — the UI shows those
  separately.`;

  const userPrompt = `Sender/Domain: ${identifier}

${emailSummaries}`;

  const content = await chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 5000,
    response_format: structuredFormat('profile_bootstrap', 'Sender profile classification and summary', {
      type: 'object',
      properties: {
        sender_type: {
          type: 'string',
          description: 'Classification: newsletter, notification, human, transactional, security, calendar, or mixed',
        },
        summary: {
          type: 'string',
          description: '2-3 sentence description of the sender',
        },
      },
      required: ['sender_type', 'summary'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as ProfileResult;
}

/**
 * Evolve a sender profile summary based on a new email outcome.
 * Returns updated sender_type and summary.
 */
export async function evolveProfileSummary(
  config: OpenAIConfig,
  identifier: string,
  currentSummary: string,
  senderType: string,
  updateContext: string,
): Promise<ProfileEvolveResult> {
  const systemPrompt = `You are deciding whether a sender profile summary
needs to be revised after a new email was seen.

Default to NO CHANGE. The summary is forward-looking guidance for handling
future emails — if the new email fits the existing pattern, leave it alone
and set summary_changed=false. Only rewrite when the new email reveals a
genuinely new pattern or behaviour shift that future triage should know
about (e.g. the sender now sends transactional emails in addition to
newsletters, or has changed cadence dramatically).

When you DO rewrite, the same rules as the initial bootstrap apply:

1. Apply your own background knowledge of the sender. The identifier may
   be a well-known brand or recognisable from its name (e.g. "Smith Real
   Estate", "Jane's Kitchenware"). Use what you know.
2. Read the local-part as a signal: no-reply@, notifications@,
   newsletter@, mailer@, etc. are automated; a first.last@ mailbox is
   more likely human but not guaranteed. Humans CAN send newsletters
   from personal addresses.
3. The summary is FUTURE-LOOKING guidance, not a per-message diff.
   - Lead with what the sender IS, then what they typically send, then a
     treatment hint.
   - Do NOT write "no change detected", "still newsletter", "the latest
     email", or anything that reads as an audit log entry.
   - Do NOT include counts or stats — the UI shows those separately.
4. Update sender_type only if the new email is a clear category shift.

Return:
{
  "summary_changed": boolean,
  "sender_type": "newsletter|notification|human|transactional|security|calendar|mixed",
  "summary": "2-3 sentence forward-looking guide; if summary_changed=false, repeat the current summary verbatim"
}`;

  const userPrompt = `Sender/Domain: ${identifier}
Current sender_type: ${senderType}
Current summary: ${currentSummary}

${updateContext}`;

  const content = await chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 5000,
    response_format: structuredFormat('profile_update', 'Updated sender profile classification and summary', {
      type: 'object',
      properties: {
        summary_changed: {
          type: 'boolean',
          description: 'False when the new email fits the existing pattern and the summary should be left as-is',
        },
        sender_type: {
          type: 'string',
          description: 'Classification: newsletter, notification, human, transactional, security, calendar, or mixed',
        },
        summary: {
          type: 'string',
          description: 'Forward-looking 2-3 sentence guidance; verbatim copy of the current summary when summary_changed=false',
        },
      },
      required: ['summary_changed', 'sender_type', 'summary'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as ProfileEvolveResult;
}

/**
 * Run the prompt setup wizard. Returns questions or final generated prompts.
 */
export async function runPromptWizard(
  config: OpenAIConfig,
  systemPrompt: string,
  userPrompt: string,
): Promise<WizardResponse> {
  const content = await chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 16000,
    response_format: structuredFormat('wizard_response', 'Prompt setup wizard response with questions or final prompts', {
      type: 'object',
      properties: {
        done: {
          type: 'boolean',
          description: 'True when all questions are answered and prompts are generated',
        },
        message: {
          type: 'string',
          description: 'A brief message to the user explaining the current step',
        },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Unique question identifier',
              },
              text: {
                type: 'string',
                description: 'The question text to display',
              },
              type: {
                type: 'string',
                description: 'Question type: single_select, multi_select, or text',
              },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    value: {
                      type: 'string',
                      description: 'Option value',
                    },
                    label: {
                      type: 'string',
                      description: 'Display label',
                    },
                  },
                  required: ['value', 'label'],
                  additionalProperties: false,
                },
                description: 'Available options (empty for text type)',
              },
            },
            required: ['id', 'text', 'type', 'options'],
            additionalProperties: false,
          },
          description: 'Questions to ask the user (empty when done=true)',
        },
        prompts: {
          type: 'object',
          properties: {
            email_analyze: {
              type: 'string',
              description: 'Generated system prompt for email analysis stage',
            },
            email_actions: {
              type: 'string',
              description: 'Generated system prompt for email actions stage',
            },
          },
          required: ['email_analyze', 'email_actions'],
          additionalProperties: false,
        },
      },
      required: ['done', 'message', 'questions', 'prompts'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as WizardResponse;
}
