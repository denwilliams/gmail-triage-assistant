import type { Label } from '../types'

function parseLabel(row: Record<string, unknown>): Label {
  return {
    ...(row as unknown as Label),
    reasons: JSON.parse((row.reasons as string) || '[]'),
  }
}

export async function getAllLabels(db: D1Database, userId: number): Promise<Label[]> {
  const result = await db.prepare(
    'SELECT * FROM labels WHERE user_id = ? ORDER BY name ASC'
  ).bind(userId).all()
  return result.results.map(parseLabel)
}

export async function createLabel(db: D1Database, userId: number, name: string, description = ''): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO labels (user_id, name, description, reasons, created_at, updated_at)
    VALUES (?, ?, ?, '[]', ?, ?)
  `).bind(userId, name, description, now, now).run()
}

export async function deleteLabel(db: D1Database, userId: number, labelId: number): Promise<void> {
  await db.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?').bind(labelId, userId).run()
}
