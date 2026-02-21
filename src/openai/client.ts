import OpenAI from 'openai'
import type { EmailAnalysis, EmailActions } from '../types'

export function buildAnalyzePrompts(
  from: string, subject: string, body: string, pastSlugs: string[], customPrompt: string
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = customPrompt || `You are an email classification assistant. Analyze the email and provide a JSON response with:
1. A snake_case_slug that categorizes this type of email (e.g., "marketing_newsletter", "invoice_due", "meeting_request")
2. An array of 3-5 keywords that describe the email content
3. A single line summary (max 100 chars)

Respond ONLY with valid JSON in this format:
{"slug": "example_slug", "keywords": ["word1", "word2", "word3"], "summary": "Brief summary here"}`

  const userPrompt = `From: ${from}
Subject: ${subject}

Body:
${body}

Past slugs used from this sender: ${JSON.stringify(pastSlugs)}

Analyze this email and provide the slug, keywords, and summary.`

  return { systemPrompt, userPrompt }
}

export function buildActionsPrompts(
  from: string, subject: string, slug: string, keywords: string[], summary: string,
  _labelNames: string[], formattedLabels: string, memoryContext: string, customPrompt: string
): { systemPrompt: string; userPrompt: string } {
  let systemPrompt = customPrompt || `You are an email automation assistant. Based on the email analysis and past learnings, determine what actions to take and respond with JSON.

Available labels:
%s

Decide:
1. Which labels to apply (use exact label names from the list above, only when they clearly match)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decisions

Use the learnings from past email processing (provided below) to make better decisions about labeling and archiving.`

  if (!customPrompt) {
    systemPrompt = systemPrompt.replace('%s', formattedLabels)
  } else {
    systemPrompt += '\n\nAvailable labels:\n' + formattedLabels
  }

  const userPrompt = `From: ${from}
Subject: ${subject}
Slug: ${slug}
Keywords: ${JSON.stringify(keywords)}
Summary: ${summary}

${memoryContext}What actions should be taken for this email?`

  return { systemPrompt, userPrompt }
}

export async function analyzeEmail(
  apiKey: string, model: string,
  from: string, subject: string, body: string, pastSlugs: string[], customPrompt: string
): Promise<EmailAnalysis> {
  const client = new OpenAI({ apiKey })
  const { systemPrompt, userPrompt } = buildAnalyzePrompts(from, subject, body, pastSlugs, customPrompt)

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'email_analysis',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            keywords: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['slug', 'keywords', 'summary'],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 10000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return JSON.parse(content) as EmailAnalysis
}

export async function determineActions(
  apiKey: string, model: string,
  from: string, subject: string, slug: string, keywords: string[], summary: string,
  labelNames: string[], formattedLabels: string, memoryContext: string, customPrompt: string
): Promise<EmailActions> {
  const client = new OpenAI({ apiKey })
  const { systemPrompt, userPrompt } = buildActionsPrompts(
    from, subject, slug, keywords, summary, labelNames, formattedLabels, memoryContext, customPrompt
  )

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'email_actions',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            labels: { type: 'array', items: { type: 'string' } },
            bypass_inbox: { type: 'boolean' },
            reasoning: { type: 'string' },
          },
          required: ['labels', 'bypass_inbox', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    max_completion_tokens: 10000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return JSON.parse(content) as EmailActions
}

export async function generateMemory(
  apiKey: string, model: string, systemPrompt: string, userPrompt: string
): Promise<string> {
  const client = new OpenAI({ apiKey })
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 20000,
  })
  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('Empty response from OpenAI')
  return content
}
