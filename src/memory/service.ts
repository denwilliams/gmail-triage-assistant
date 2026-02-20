import * as db from '../db'
import { generateMemory } from '../openai/client'
import type { Env } from '../index'
import type { Email, Memory, MemoryType, Label, PromptType } from '../types'

// ── Daily memory ──────────────────────────────────────────────────────────────

export async function generateDailyMemory(env: Env, userId: number): Promise<void> {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  const startOfYesterday = new Date(yesterday)
  startOfYesterday.setHours(0, 0, 0, 0)
  const endOfYesterday = new Date(startOfYesterday)
  endOfYesterday.setHours(24, 0, 0, 0)

  let emails = await db.getEmailsByDateRange(
    env.DB, userId,
    startOfYesterday.toISOString(),
    endOfYesterday.toISOString()
  )

  if (emails.length === 0) {
    // Fallback: last 24 hours
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    emails = await db.getEmailsByDateRange(env.DB, userId, since.toISOString(), now.toISOString())
    if (emails.length === 0) {
      console.log(`No emails for user ${userId}, skipping daily memory`)
      return
    }
  }

  const customPrompt = await getPromptContent(env, userId, 'daily_review')
  const labels = await db.getAllLabels(env.DB, userId)
  const content = await generateMemoryFromEmails(env, emails, labels, customPrompt)

  await db.createMemory(env.DB, {
    user_id: userId,
    type: 'daily',
    content,
    start_date: startOfYesterday.toISOString(),
    end_date: endOfYesterday.toISOString(),
  })

  console.log(`✓ Daily memory created for user ${userId} (${emails.length} emails)`)
}

// ── Weekly memory ─────────────────────────────────────────────────────────────

export async function generateWeeklyMemory(env: Env, userId: number): Promise<void> {
  const now = new Date()
  const endDate = new Date(now)
  endDate.setHours(0, 0, 0, 0)
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - 7)

  const [previousWeekly] = await db.getMemoriesByType(env.DB, userId, 'weekly', 1)

  const dailyStart = previousWeekly ? new Date(previousWeekly.end_date) : startDate
  const dailyMemories = await db.getMemoriesByDateRange(
    env.DB, userId, 'daily', dailyStart.toISOString(), endDate.toISOString()
  )

  if (dailyMemories.length === 0) {
    console.log(`No new daily memories for user ${userId}, skipping weekly memory`)
    return
  }

  const customPrompt = await getPromptContent(env, userId, 'weekly_summary')
  const content = await consolidateMemories(env, previousWeekly ?? null, dailyMemories, 'weekly', customPrompt)

  await db.createMemory(env.DB, {
    user_id: userId,
    type: 'weekly',
    content,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  })

  console.log(`✓ Weekly memory created for user ${userId}`)
}

// ── Monthly memory ────────────────────────────────────────────────────────────

export async function generateMonthlyMemory(env: Env, userId: number): Promise<void> {
  const now = new Date()
  const endDate = new Date(now.getFullYear(), now.getMonth(), 1)
  const startDate = new Date(endDate)
  startDate.setMonth(startDate.getMonth() - 1)

  const [previousMonthly] = await db.getMemoriesByType(env.DB, userId, 'monthly', 1)

  const weeklyStart = previousMonthly ? new Date(previousMonthly.end_date) : startDate
  const weeklyMemories = await db.getMemoriesByDateRange(
    env.DB, userId, 'weekly', weeklyStart.toISOString(), endDate.toISOString()
  )

  if (weeklyMemories.length === 0) {
    console.log(`No new weekly memories for user ${userId}, skipping monthly memory`)
    return
  }

  const customPrompt = await getPromptContent(env, userId, 'monthly_summary')
  const content = await consolidateMemories(env, previousMonthly ?? null, weeklyMemories, 'monthly', customPrompt)

  await db.createMemory(env.DB, {
    user_id: userId,
    type: 'monthly',
    content,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  })

  console.log(`✓ Monthly memory created for user ${userId}`)
}

// ── Yearly memory ─────────────────────────────────────────────────────────────

export async function generateYearlyMemory(env: Env, userId: number): Promise<void> {
  const now = new Date()
  const endDate = new Date(now.getFullYear(), 0, 1)
  const startDate = new Date(endDate)
  startDate.setFullYear(startDate.getFullYear() - 1)

  const [previousYearly] = await db.getMemoriesByType(env.DB, userId, 'yearly', 1)

  const monthlyStart = previousYearly ? new Date(previousYearly.end_date) : startDate
  const monthlyMemories = await db.getMemoriesByDateRange(
    env.DB, userId, 'monthly', monthlyStart.toISOString(), endDate.toISOString()
  )

  if (monthlyMemories.length === 0) {
    console.log(`No new monthly memories for user ${userId}, skipping yearly memory`)
    return
  }

  const customPrompt = await getPromptContent(env, userId, 'yearly_summary')
  const content = await consolidateMemories(env, previousYearly ?? null, monthlyMemories, 'yearly', customPrompt)

  await db.createMemory(env.DB, {
    user_id: userId,
    type: 'yearly',
    content,
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
  })

  console.log(`✓ Yearly memory created for user ${userId}`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getPromptContent(env: Env, userId: number, type: PromptType): Promise<string> {
  const prompt = await db.getSystemPrompt(env.DB, userId, type)
  return prompt?.content ?? ''
}

async function generateMemoryFromEmails(
  env: Env, emails: Email[], labels: Label[], customPrompt: string
): Promise<string> {
  const labelsSection = labels.length > 0
    ? `\n\nAvailable labels (ONLY reference these exact label names in your learnings):\n${
        labels.map(l => l.description ? `- ${l.name}: ${l.description}` : `- ${l.name}`).join('\n')
      }`
    : ''

  const systemPrompt = customPrompt || `You are an AI assistant creating learnings to improve future email processing decisions. Your goal is NOT to summarize what happened, but to extract insights that will help process emails better tomorrow.

Analyze the emails and their categorizations, then create a memory focused on:

**Key learnings for tomorrow:**
- Specific rules to apply (e.g., "emails from @company.com with 'invoice' should get Urgent label")
- Sender patterns to remember
- Content patterns that indicate specific labels

**What worked well:**
- Categorization decisions that seem correct and should be repeated
- Patterns successfully identified (e.g., "newsletters from X always get archived")
- Sender behaviors correctly recognized

**What to improve:**
- Emails that may have been miscategorized and why
- Patterns that were missed or incorrectly applied
- Better ways to handle similar emails in the future

IMPORTANT: Keep your response CONCISE - aim for around 100 words maximum. Be specific and actionable. Focus only on the most important insights that will directly improve future email processing. Format as concise bullet points.` + labelsSection

  const emailSummaries: string[] = []
  const humanFeedbackItems: string[] = []

  for (let i = 0; i < Math.min(emails.length, 50); i++) {
    const e = emails[i]
    const reasoning = e.reasoning ? ` | AI Reasoning: ${e.reasoning}` : ''
    emailSummaries.push(
      `- From: ${e.from_address} | Subject: ${e.subject} | Slug: ${e.slug} | Labels: ${JSON.stringify(e.labels_applied)} | Archived: ${e.bypassed_inbox} | Keywords: ${JSON.stringify(e.keywords)}${reasoning}`
    )
    if (e.human_feedback) {
      humanFeedbackItems.push(`- Email from ${e.from_address} (Subject: ${e.subject}): ${e.human_feedback}`)
    }
  }

  if (emails.length > 50) {
    emailSummaries.push(`... and ${emails.length - 50} more emails`)
  }

  const humanFeedbackSection = humanFeedbackItems.length > 0
    ? `\n\n**IMPORTANT - HUMAN FEEDBACK (PRIORITIZE THESE):**\nThe human provided explicit feedback on these emails. These instructions are CRITICAL and must be prominently included in your memory:\n\n${humanFeedbackItems.join('\n')}\n\nThese human corrections should be given highest priority in your learnings.\n\n`
    : ''

  const userPrompt = `Review these ${emails.length} processed emails and extract learnings to improve future email handling:\n\n${emailSummaries.join('\n')}${humanFeedbackSection}\nFocus on creating actionable insights that will help process similar emails better in the future. What patterns should be reinforced? What should be done differently?`

  return generateMemory(env.OPENAI_API_KEY, env.OPENAI_MODEL, systemPrompt, userPrompt)
}

async function consolidateMemories(
  env: Env,
  previousMemory: Memory | null,
  newMemories: Memory[],
  period: string,
  customPrompt: string
): Promise<string> {
  let systemPrompt = customPrompt
  if (!systemPrompt) {
    if (previousMemory) {
      systemPrompt = `You are an AI assistant evolving a ${period} email processing memory. Your task is to UPDATE the existing memory by incorporating new insights from recent lower-level memories.

DO NOT write a new memory from scratch. Instead:

**Reinforce patterns:**
- Keep and strengthen insights that are still relevant and being validated by new data
- Note when patterns continue or become more pronounced

**Amend differences:**
- Update or refine insights when new data shows changes in patterns
- Add new learnings that weren't in the previous memory
- Remove or de-emphasize insights that are no longer relevant

**Maintain continuity:**
- Build on the existing memory's structure and insights
- Show evolution over time rather than replacement
- Keep the most valuable long-term learnings

IMPORTANT: Keep your response concise - aim for around 400 words maximum. Focus only on the most significant changes and patterns. The goal is an EVOLVED memory that's better than the previous one, not a brand new memory. Format as bullet points.`
    } else {
      systemPrompt = `You are an AI assistant creating the first ${period} email processing memory. Review the provided memories and create insights focused on:

1. Identifying overarching patterns and trends
2. Highlighting important behavioral patterns
3. Noting recurring themes
4. Providing strategic insights for email management
5. Suggesting process improvements

IMPORTANT: Keep your response concise - aim for around 800 words maximum. Focus on the most important actionable patterns. Format as bullet points.`
    }
  }

  const memorySummaries = newMemories.map((mem, i) =>
    `New Memory ${i + 1} (${mem.start_date.slice(0, 10)} to ${mem.end_date.slice(0, 10)}):\n${mem.content}`
  )

  let userPrompt: string
  if (previousMemory) {
    userPrompt = `**CURRENT ${period.toUpperCase()} MEMORY (to be evolved):**
Period: ${previousMemory.start_date.slice(0, 10)} to ${previousMemory.end_date.slice(0, 10)}
${previousMemory.content}

**NEW INSIGHTS FROM RECENT MEMORIES (${newMemories.length} new):**
${memorySummaries.join('\n\n')}

Task: Evolve the current memory by:
1. Reinforcing patterns that continue in the new memories
2. Updating insights where new data shows changes
3. Adding new learnings not present in current memory
4. Removing outdated insights

Output an evolved ${period} memory that builds on the current one.`
  } else {
    userPrompt = `Create the first ${period} memory by consolidating these ${newMemories.length} memories:\n\n${memorySummaries.join('\n\n')}\n\nProvide a concise ${period} summary with key patterns and strategic insights.`
  }

  return generateMemory(env.OPENAI_API_KEY, env.OPENAI_MODEL, systemPrompt, userPrompt)
}
