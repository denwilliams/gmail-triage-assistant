import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { SystemPrompt, AIPrompt, PromptType } from '../types/models';
import {
  getAllSystemPrompts,
  getLatestAIPrompt,
  upsertSystemPrompt,
  initializeDefaultPrompts,
} from '../db/prompts';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function systemPromptToJSON(p: SystemPrompt) {
  return {
    id: p.id,
    user_id: p.userId,
    type: p.type,
    content: p.content,
    is_active: p.isActive,
    description: p.description,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

function aiPromptToJSON(p: AIPrompt) {
  return {
    id: p.id,
    user_id: p.userId,
    type: p.type,
    content: p.content,
    version: p.version,
    created_at: p.createdAt,
  };
}

export async function handleGetPrompts(c: AppContext) {
  const userId = c.get('userId');

  try {
    const prompts = await getAllSystemPrompts(c.env.DB, userId);
    const aiAnalyze = await getLatestAIPrompt(c.env.DB, userId, 'email_analyze');
    const aiActions = await getLatestAIPrompt(c.env.DB, userId, 'email_actions');

    return c.json({
      prompts: prompts.map(systemPromptToJSON),
      ai_analyze: aiAnalyze ? aiPromptToJSON(aiAnalyze) : null,
      ai_actions: aiActions ? aiPromptToJSON(aiActions) : null,
    });
  } catch (e) {
    console.error('Failed to load prompts:', e);
    return c.json({ error: 'Failed to load prompts' }, 500);
  }
}

export async function handleUpdatePrompt(c: AppContext) {
  const userId = c.get('userId');

  const body = await c.req.json<{ type?: string; content?: string }>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  try {
    await upsertSystemPrompt(c.env.DB, userId, body.type as PromptType, body.content ?? '', true);
    return c.json({ status: 'updated' });
  } catch (e) {
    console.error('Failed to update prompt:', e);
    return c.json({ error: 'Failed to update prompt' }, 500);
  }
}

export async function handleInitDefaults(c: AppContext) {
  const userId = c.get('userId');

  try {
    await initializeDefaultPrompts(c.env.DB, userId);
    return c.json({ status: 'initialized' });
  } catch (e) {
    console.error('Failed to initialize defaults:', e);
    return c.json({ error: 'Failed to initialize defaults' }, 500);
  }
}
