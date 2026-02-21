import type { SystemPrompt, PromptType } from '../types'

export async function getSystemPrompt(
  db: D1Database, userId: number, type: PromptType
): Promise<SystemPrompt | null> {
  return db.prepare(`
    SELECT * FROM system_prompts WHERE user_id = ? AND type = ? AND is_active = 1
  `).bind(userId, type).first<SystemPrompt>()
}

export async function getAllSystemPrompts(db: D1Database, userId: number): Promise<SystemPrompt[]> {
  const result = await db.prepare(
    'SELECT * FROM system_prompts WHERE user_id = ? ORDER BY type'
  ).bind(userId).all<SystemPrompt>()
  return result.results
}

export async function upsertSystemPrompt(
  db: D1Database, userId: number, type: PromptType, content: string
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare('UPDATE system_prompts SET is_active = 0 WHERE user_id = ? AND type = ?')
    .bind(userId, type).run()
  await db.prepare(`
    INSERT INTO system_prompts (user_id, type, content, is_active, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?)
  `).bind(userId, type, content, now, now).run()
}

export async function initDefaultPrompts(db: D1Database, userId: number): Promise<void> {
  const defaults: Array<{ type: PromptType; content: string }> = [
    {
      type: 'email_analyze',
      content: `You are an email classification assistant. Analyze the email and provide a JSON response with:
1. A snake_case_slug that categorizes this type of email (e.g., "marketing_newsletter", "invoice_due", "meeting_request")
2. An array of 3-5 keywords that describe the email content
3. A single line summary (max 100 chars)

Respond ONLY with valid JSON in this format:
{"slug": "example_slug", "keywords": ["word1", "word2", "word3"], "summary": "Brief summary here"}`,
    },
    {
      type: 'email_actions',
      content: `You are an email automation assistant. Based on the email analysis and past learnings, determine what actions to take and respond with JSON.

Available labels:
%s

Decide:
1. Which labels to apply (use exact label names from the list above, only when they clearly match)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decisions`,
    },
    {
      type: 'daily_review',
      content: `You are an AI assistant creating learnings to improve future email processing decisions. Extract actionable insights. Keep concise (~100 words). Format as bullet points.`,
    },
  ]

  for (const def of defaults) {
    const existing = await getSystemPrompt(db, userId, def.type)
    if (!existing) {
      await upsertSystemPrompt(db, userId, def.type, def.content)
    }
  }
}
