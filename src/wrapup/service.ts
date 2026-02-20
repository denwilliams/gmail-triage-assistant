import * as db from '../db'
import { generateMemory } from '../openai/client'
import type { Env } from '../index'
import type { Email } from '../types'

export async function generateMorningWrapup(env: Env, userId: number): Promise<void> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  // Since 5PM yesterday
  const since = new Date(yesterday)
  since.setHours(17, 0, 0, 0)

  const emails = await db.getEmailsByDateRange(env.DB, userId, since.toISOString(), now.toISOString())
  if (emails.length === 0) {
    console.log(`No emails since yesterday evening for user ${userId}, skipping morning wrapup`)
    return
  }

  const content = await generateWrapupContent(env, emails, 'morning')
  await db.createWrapupReport(env.DB, {
    user_id: userId,
    report_type: 'morning',
    email_count: emails.length,
    content,
    generated_at: now.toISOString(),
  })

  console.log(`✓ Morning wrapup created for user ${userId} (${emails.length} emails)`)
}

export async function generateEveningWrapup(env: Env, userId: number): Promise<void> {
  const now = new Date()
  // Since 8AM today
  const since = new Date(now)
  since.setHours(8, 0, 0, 0)

  const emails = await db.getEmailsByDateRange(env.DB, userId, since.toISOString(), now.toISOString())
  if (emails.length === 0) {
    console.log(`No emails since this morning for user ${userId}, skipping evening wrapup`)
    return
  }

  const content = await generateWrapupContent(env, emails, 'evening')
  await db.createWrapupReport(env.DB, {
    user_id: userId,
    report_type: 'evening',
    email_count: emails.length,
    content,
    generated_at: now.toISOString(),
  })

  console.log(`✓ Evening wrapup created for user ${userId} (${emails.length} emails)`)
}

async function generateWrapupContent(env: Env, emails: Email[], reportType: string): Promise<string> {
  const customPrompt = await getWrapupPrompt(env, emails[0].user_id)

  const systemPrompt = customPrompt || `You are an AI assistant creating an email processing summary report. Review the emails and provide a concise wrapup including:
1. Total number of emails processed
2. Most common senders and types
3. Most interesting or important emails (based on subject and sender) and why
4. Labels applied summary
5. Any notable patterns or important emails
6. Quick overview of what was archived vs kept in inbox

Keep it brief and actionable - this is a daily digest for quick review.`

  const emailSummaries: string[] = []
  for (let i = 0; i < Math.min(emails.length, 100); i++) {
    const e = emails[i]
    const archived = e.bypassed_inbox ? ' [ARCHIVED]' : ''
    emailSummaries.push(`- ${e.from_address}: ${e.subject} | Labels: ${JSON.stringify(e.labels_applied)}${archived}`)
  }
  if (emails.length > 100) {
    emailSummaries.push(`... and ${emails.length - 100} more emails`)
  }

  const timeframe = reportType === 'evening' ? 'today' : 'overnight'
  const userPrompt = `Create a ${reportType} wrapup report for these ${emails.length} emails processed ${timeframe}:\n\n${emailSummaries.join('\n')}\n\nProvide a brief, scannable summary.`

  return generateMemory(env.OPENAI_API_KEY, env.OPENAI_MODEL, systemPrompt, userPrompt)
}

async function getWrapupPrompt(env: Env, userId: number): Promise<string> {
  const prompt = await db.getSystemPrompt(env.DB, userId, 'wrapup_report')
  return prompt?.content ?? ''
}
