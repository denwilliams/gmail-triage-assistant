import type { Context } from 'hono';
import type { Env } from '../types/env';
import type { Memory } from '../types/models';
import { getAllMemories } from '../db/memories';
import { generateDailyMemory, generateAIPrompts as generateAIPromptsJob } from '../jobs/memory';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function memoryToJSON(m: Memory) {
  return {
    id: m.id,
    user_id: m.userId,
    type: m.type,
    content: m.content,
    reasoning: m.reasoning,
    start_date: m.startDate,
    end_date: m.endDate,
    created_at: m.createdAt,
  };
}

export async function handleGetMemories(c: AppContext) {
  const userId = c.get('userId');
  let limit = 100;
  const lParam = c.req.query('limit');
  if (lParam) {
    const parsed = parseInt(lParam, 10);
    if (!isNaN(parsed) && parsed > 0) limit = parsed;
  }

  try {
    const memories = await getAllMemories(c.env.DB, userId, limit);
    return c.json(memories.map(memoryToJSON));
  } catch (e) {
    console.error('Failed to load memories:', e);
    return c.json({ error: 'Failed to load memories' }, 500);
  }
}

export async function handleGenerateMemory(c: AppContext) {
  const userId = c.get('userId');
  try {
    await generateDailyMemory(c.env, userId);
    return c.json({ status: 'ok' });
  } catch (e) {
    console.error('Failed to generate memory:', e);
    return c.json({ error: 'Failed to generate memory' }, 500);
  }
}

export async function handleGenerateAIPrompts(c: AppContext) {
  const userId = c.get('userId');
  try {
    await generateAIPromptsJob(c.env, userId);
    return c.json({ status: 'ok' });
  } catch (e) {
    console.error('Failed to generate AI prompts:', e);
    return c.json({ error: 'Failed to generate AI prompts' }, 500);
  }
}
