import { GmailClient } from '../gmail/client'
import { analyzeEmail, determineActions } from '../openai/client'
import * as db from '../db'
import type { Env } from '../index'
import type { User, Memory } from '../types'

export function buildMemoryContext(memories: Memory[]): string {
  if (!memories.length) return ''
  let ctx = 'Past learnings from email processing:\n\n'
  for (const mem of memories) {
    ctx += `**${mem.type.toUpperCase()} Memory:**\n${mem.content}\n\n`
  }
  return ctx
}

function truncateBody(body: string, maxLen = 2000): string {
  return body.length > maxLen ? body.slice(0, maxLen) + '...' : body
}

export async function processEmail(
  env: Env,
  user: User,
  messageId: string,
): Promise<void> {
  // Skip if already processed
  if (await db.emailExists(env.DB, messageId)) {
    console.log(`[${user.email}] Email ${messageId} already processed, skipping`)
    return
  }

  const client = new GmailClient(user.access_token)
  const message = await client.getMessage(messageId)

  console.log(`[${user.email}] Processing: ${message.from} - ${message.subject}`)

  const body = truncateBody(message.body)

  // Get system prompts
  const analyzePromptRow = await db.getSystemPrompt(env.DB, user.id, 'email_analyze')
  const actionsPromptRow = await db.getSystemPrompt(env.DB, user.id, 'email_actions')

  // Get memory context
  const memories = await db.getRecentMemoriesForContext(env.DB, user.id)
  const memoryContext = buildMemoryContext(memories)

  // Stage 1: Analyze
  const pastSlugs = await db.getPastSlugsFromSender(env.DB, user.id, message.from, 5)
  const analysis = await analyzeEmail(
    env.OPENAI_API_KEY, env.OPENAI_MODEL,
    message.from, message.subject, body, pastSlugs, analyzePromptRow?.content ?? ''
  )

  console.log(`[${user.email}] Stage 1 - Slug: ${analysis.slug}`)

  // Stage 2: Determine actions
  const labels = await db.getAllLabels(env.DB, user.id)
  const labelNames = labels.map(l => l.name)
  const formattedLabels = labels.map(l => {
    let line = `- "${l.name}"`
    if (l.description) line += `: ${l.description}`
    if (l.reasons.length) line += ` (e.g. ${l.reasons.join(', ')})`
    return line
  }).join('\n')

  const actions = await determineActions(
    env.OPENAI_API_KEY, env.OPENAI_MODEL,
    message.from, message.subject, analysis.slug, analysis.keywords, analysis.summary,
    labelNames, formattedLabels, memoryContext, actionsPromptRow?.content ?? ''
  )

  console.log(`[${user.email}] Stage 2 - Labels: ${actions.labels}, Bypass: ${actions.bypass_inbox}`)

  // Save to DB
  await db.createEmail(env.DB, {
    id: message.id,
    user_id: user.id,
    from_address: message.from,
    subject: message.subject,
    slug: analysis.slug,
    keywords: analysis.keywords,
    summary: analysis.summary,
    labels_applied: actions.labels,
    bypassed_inbox: actions.bypass_inbox,
    reasoning: actions.reasoning,
    human_feedback: '',
    processed_at: new Date().toISOString(),
  })

  // Apply to Gmail
  await applyToGmail(client, message.id, actions.labels, actions.bypass_inbox)

  console.log(`[${user.email}] ✓ Processed: ${message.subject}`)
}

async function applyToGmail(
  client: GmailClient, messageId: string, labelNames: string[], bypassInbox: boolean
): Promise<void> {
  if (labelNames.length > 0) {
    const labelIds = await Promise.all(labelNames.map(name => client.getOrCreateLabelId(name)))
    await client.addLabels(messageId, labelIds.filter(Boolean) as string[])
  }
  if (bypassInbox) {
    await client.archiveMessage(messageId)
  }
}
