import type { Context } from 'hono';
import type { Env } from '../types/env';
import { getAllLabels, createLabel, updateLabel, deleteLabel } from '../db/labels';
import type { Label } from '../types/models';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function labelToJSON(l: Label) {
  return {
    id: l.id,
    user_id: l.userId,
    name: l.name,
    reasons: l.reasons,
    description: l.description,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

export async function handleGetLabels(c: AppContext) {
  const userId = c.get('userId');
  try {
    const labels = await getAllLabels(c.env.DB, userId);
    return c.json(labels.map(labelToJSON));
  } catch (e) {
    console.error('Failed to load labels:', e);
    return c.json({ error: 'Failed to load labels' }, 500);
  }
}

export async function handleCreateLabel(c: AppContext) {
  const userId = c.get('userId');
  const body = await c.req.json<{ name?: string; description?: string }>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.name) {
    return c.json({ error: 'Label name is required' }, 400);
  }

  try {
    const id = await createLabel(c.env.DB, {
      userId,
      name: body.name,
      description: body.description ?? '',
      reasons: [],
    });
    const now = new Date().toISOString();
    return c.json(
      labelToJSON({
        id,
        userId,
        name: body.name,
        description: body.description ?? '',
        reasons: [],
        createdAt: now,
        updatedAt: now,
      }),
      201,
    );
  } catch (e) {
    console.error('Failed to create label:', e);
    return c.json({ error: 'Failed to create label' }, 500);
  }
}

export async function handleUpdateLabel(c: AppContext) {
  const userId = c.get('userId');
  const labelId = c.req.param('id') ?? '';
  const id = parseInt(labelId, 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid label ID' }, 400);
  }

  const body = await c.req.json<{ name?: string; description?: string; reasons?: string[] }>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  if (!body.name) {
    return c.json({ error: 'Label name is required' }, 400);
  }

  const reasons = body.reasons ?? [];
  const label: Label = {
    id,
    userId,
    name: body.name,
    description: body.description ?? '',
    reasons,
    createdAt: '',
    updatedAt: '',
  };

  try {
    await updateLabel(c.env.DB, label);
    const now = new Date().toISOString();
    return c.json(labelToJSON({ ...label, updatedAt: now }));
  } catch (e) {
    console.error('Failed to update label:', e);
    return c.json({ error: 'Failed to update label' }, 500);
  }
}

export async function handleDeleteLabel(c: AppContext) {
  const userId = c.get('userId');
  const labelId = c.req.param('id') ?? '';
  const id = parseInt(labelId, 10);
  if (isNaN(id)) {
    return c.json({ error: 'Invalid label ID' }, 400);
  }

  try {
    await deleteLabel(c.env.DB, userId, id);
    return c.json({ status: 'deleted' });
  } catch (e) {
    console.error('Failed to delete label:', e);
    return c.json({ error: 'Failed to delete label' }, 500);
  }
}
