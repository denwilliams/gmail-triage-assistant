import type {
  SystemPrompt,
  SystemPromptRow,
  PromptType,
  AIPrompt,
  AIPromptRow,
  AIPromptType,
} from '../types/models';

// ============================================================================
// Mapper functions
// ============================================================================

function mapSystemPrompt(row: SystemPromptRow): SystemPrompt {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as PromptType,
    content: row.content,
    isActive: row.is_active === 1,
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAIPrompt(row: AIPromptRow): AIPrompt {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as AIPromptType,
    content: row.content,
    version: row.version,
    createdAt: row.created_at,
  };
}

// ============================================================================
// Default prompts (matches Go version)
// ============================================================================

const DEFAULT_PROMPTS: Partial<Record<PromptType, string>> = {
  email_analyze: `You are an AI email analyst. Analyze the email and provide:
1. A short slug (2-4 words) categorizing the sender/topic
2. 3-5 keywords describing the content
3. A one-sentence summary

Be consistent with slugs - reuse existing slugs when appropriate.`,

  email_actions: `You are an AI email manager. Based on the email analysis and available labels, decide:
1. Which labels to apply (choose from the provided list)
2. Whether to bypass the inbox (archive immediately)
3. Brief reasoning for your decision

Only apply labels that accurately match the email content.`,
};

// ============================================================================
// System Prompts
// ============================================================================

export async function getSystemPrompt(
  db: D1Database,
  userId: number,
  promptType: PromptType,
): Promise<SystemPrompt | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, type, content, is_active, description, created_at, updated_at
       FROM system_prompts
       WHERE user_id = ? AND type = ?`,
    )
    .bind(userId, promptType)
    .first<SystemPromptRow>();
  return row ? mapSystemPrompt(row) : null;
}

export async function getAllSystemPrompts(db: D1Database, userId: number): Promise<SystemPrompt[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, type, content, is_active, description, created_at, updated_at
       FROM system_prompts
       WHERE user_id = ?
       ORDER BY type`,
    )
    .bind(userId)
    .all<SystemPromptRow>();
  return results.map(mapSystemPrompt);
}

export async function upsertSystemPrompt(
  db: D1Database,
  userId: number,
  type: PromptType,
  content: string,
  isActive: boolean,
): Promise<number> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO system_prompts (user_id, type, content, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, type)
       DO UPDATE SET content = excluded.content, is_active = excluded.is_active, updated_at = excluded.updated_at
       RETURNING id`,
    )
    .bind(userId, type, content, isActive ? 1 : 0, now, now)
    .first<{ id: number }>();
  if (!row) throw new Error('Failed to upsert system prompt');
  return row.id;
}

export async function initializeDefaultPrompts(db: D1Database, userId: number): Promise<void> {
  for (const [type, content] of Object.entries(DEFAULT_PROMPTS)) {
    await upsertSystemPrompt(db, userId, type as PromptType, content, true);
  }
}

// ============================================================================
// AI Prompts (versioned)
// ============================================================================

export async function getLatestAIPrompt(
  db: D1Database,
  userId: number,
  promptType: AIPromptType,
): Promise<AIPrompt | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, type, content, version, created_at
       FROM ai_prompts
       WHERE user_id = ? AND type = ?
       ORDER BY version DESC
       LIMIT 1`,
    )
    .bind(userId, promptType)
    .first<AIPromptRow>();
  return row ? mapAIPrompt(row) : null;
}

export async function createAIPrompt(
  db: D1Database,
  userId: number,
  type: AIPromptType,
  content: string,
): Promise<AIPrompt> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO ai_prompts (user_id, type, content, version, created_at)
       VALUES (?, ?, ?, COALESCE((
         SELECT MAX(version) FROM ai_prompts WHERE user_id = ? AND type = ?
       ), 0) + 1, ?)
       RETURNING id, user_id, type, content, version, created_at`,
    )
    .bind(userId, type, content, userId, type, now)
    .first<AIPromptRow>();
  if (!row) throw new Error('Failed to create AI prompt');
  return mapAIPrompt(row);
}

export async function getAIPromptHistory(
  db: D1Database,
  userId: number,
  promptType: AIPromptType,
  limit: number,
): Promise<AIPrompt[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, type, content, version, created_at
       FROM ai_prompts
       WHERE user_id = ? AND type = ?
       ORDER BY version DESC
       LIMIT ?`,
    )
    .bind(userId, promptType, limit)
    .all<AIPromptRow>();
  return results.map(mapAIPrompt);
}
