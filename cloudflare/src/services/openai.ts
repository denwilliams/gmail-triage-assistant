// OpenAI API client using Workers fetch()
// All calls use the Chat Completions endpoint with structured output via response_format.

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

// ---------- Result types ----------

export interface EmailAnalysis {
  slug: string;
  keywords: string[];
  summary: string;
}

export interface EmailActions {
  labels: string[];
  bypass_inbox: boolean;
  notification_message: string;
  reasoning: string;
}

export interface MemoryResult {
  content: string;
  reasoning: string;
}

export interface ProfileResult {
  sender_type: string;
  summary: string;
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

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_completion_tokens?: number;
  response_format?: any;
}

async function chatCompletion(config: OpenAIConfig, req: ChatCompletionRequest): Promise<string> {
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

function structuredFormat(name: string, description: string, schema: Record<string, any>): any {
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
 * Stage 1: Analyze email content.
 * Returns slug, keywords, and summary.
 */
export async function analyzeEmail(
  config: OpenAIConfig,
  from: string,
  subject: string,
  body: string,
  senderContext: string,
  customSystemPrompt: string,
): Promise<EmailAnalysis> {
  const systemPrompt =
    customSystemPrompt ||
    `You are an email classification assistant. Analyze the email and provide a JSON response with:
1. A snake_case_slug that categorizes this type of email (e.g., "marketing_newsletter", "invoice_due", "meeting_request")
2. An array of 3-5 keywords that describe the email content
3. A single line summary (max 100 chars)

Respond ONLY with valid JSON in this format:
{"slug": "example_slug", "keywords": ["word1", "word2", "word3"], "summary": "Brief summary here"}`;

  const userPrompt = `From: ${from}
Subject: ${subject}

Body:
${body}

${senderContext}Analyze this email and provide the slug, keywords, and summary.`;

  const content = await chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 10000,
    response_format: structuredFormat('email_analysis', 'Email content analysis with slug, keywords, and summary', {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'A snake_case_slug categorizing the email type',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: '3-5 keywords describing the email content',
        },
        summary: {
          type: 'string',
          description: 'Single line summary (max 100 chars)',
        },
      },
      required: ['slug', 'keywords', 'summary'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as EmailAnalysis;
}

/**
 * Stage 2: Determine actions for an analyzed email.
 * Returns labels, bypass_inbox, notification_message, and reasoning.
 */
export async function determineActions(
  config: OpenAIConfig,
  from: string,
  subject: string,
  slug: string,
  keywords: string[],
  summary: string,
  labelNames: string[],
  formattedLabels: string,
  senderContext: string,
  memoryContext: string,
  customSystemPrompt: string,
): Promise<EmailActions> {
  let systemPrompt: string;

  if (customSystemPrompt) {
    // Always append labels to custom prompts so they're never lost
    systemPrompt = customSystemPrompt + '\n\nAvailable labels:\n' + formattedLabels;
  } else {
    systemPrompt = `You are an email automation assistant. Based on the email analysis and past learnings, determine what actions to take and respond with JSON.

Available labels:
${formattedLabels}

Decide:
1. Which labels to apply (use exact label names from the list above, only when they clearly match)
2. Whether to bypass the inbox (archive immediately)
3. notification_message: leave blank unless this is an important email the user should be alerted about immediately. When needed, write a short friendly message summarizing why it matters (e.g. "Hi, the school nurse said your daughter was taken to the sick bay" or "Heads up — you have a late invoice from PowerCo"). Keep it conversational and to the point.
4. Brief reasoning for your decisions

Use the learnings from past email processing (provided below) to make better decisions about labeling and archiving.`;
  }

  const userPrompt = `From: ${from}
Subject: ${subject}
Slug: ${slug}
Keywords: ${JSON.stringify(keywords)}
Summary: ${summary}

${senderContext}${memoryContext}What actions should be taken for this email?`;

  const content = await chatCompletion(config, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 10000,
    response_format: structuredFormat('email_actions', 'Email automation actions including labels and inbox bypass', {
      type: 'object',
      properties: {
        labels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of label names to apply',
        },
        bypass_inbox: {
          type: 'boolean',
          description: 'Whether to archive the email immediately',
        },
        notification_message: {
          type: 'string',
          description:
            'Short friendly notification message explaining why this email matters. Leave as empty string unless the email is important enough to alert the user immediately.',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of the decision',
        },
      },
      required: ['labels', 'bypass_inbox', 'notification_message', 'reasoning'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as EmailActions;
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
  const systemPrompt = `You are analyzing historical emails to create a sender profile.

Given the email history below, produce a JSON response:
{
  "sender_type": "human|newsletter|automated|marketing|notification",
  "summary": "2-3 sentence description of who this sender is, what they typically send, and how their emails should be handled"
}

Classify sender_type as:
- human: personal or professional correspondence from an individual
- newsletter: regular informational content or digests
- automated: system-generated messages (receipts, confirmations, alerts)
- marketing: promotional content, sales, offers
- notification: app/service notifications (social media, tools, etc.)`;

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
          description: 'Classification: human, newsletter, automated, marketing, or notification',
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
  currentSummary: string,
  senderType: string,
  updateContext: string,
): Promise<ProfileResult> {
  const systemPrompt = `You are updating a sender profile after a new email was processed.

Given the current profile summary and a new email outcome, produce an updated JSON response:
{
  "sender_type": "human|newsletter|automated|marketing|notification",
  "summary": "updated 2-3 sentence summary"
}

Rules:
- Reinforce patterns that continue
- Note any changes in behavior
- Keep it to 2-3 sentences max
- Update sender_type only if behavior has clearly shifted`;

  const userPrompt = `Current sender type: ${senderType}
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
        sender_type: {
          type: 'string',
          description: 'Classification: human, newsletter, automated, marketing, or notification',
        },
        summary: {
          type: 'string',
          description: 'Updated 2-3 sentence summary',
        },
      },
      required: ['sender_type', 'summary'],
      additionalProperties: false,
    }),
  });

  return JSON.parse(content) as ProfileResult;
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
