import type { Label, LabelRow } from '../types/models';

function mapLabel(row: LabelRow): Label {
  let reasons: string[] = [];
  try {
    reasons = JSON.parse(row.reasons) as string[];
  } catch {
    reasons = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    reasons,
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createLabel(db: D1Database, label: Omit<Label, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  const now = new Date().toISOString();
  const row = await db
    .prepare(
      `INSERT INTO labels (user_id, name, reasons, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(label.userId, label.name, JSON.stringify(label.reasons), label.description, now, now)
    .first<{ id: number }>();

  if (!row) throw new Error('Failed to create label');
  return row.id;
}

export async function getAllLabels(db: D1Database, userId: number): Promise<Label[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, reasons, description, created_at, updated_at
       FROM labels
       WHERE user_id = ?
       ORDER BY name`,
    )
    .bind(userId)
    .all<LabelRow>();
  return results.map(mapLabel);
}

export async function getUserLabelsWithDetails(db: D1Database, userId: number): Promise<Label[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, COALESCE(description, '') as description, reasons, created_at, updated_at
       FROM labels
       WHERE user_id = ?
       ORDER BY name`,
    )
    .bind(userId)
    .all<LabelRow>();
  return results.map(mapLabel);
}

export async function updateLabel(db: D1Database, label: Label): Promise<void> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE labels SET name = ?, description = ?, reasons = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(label.name, label.description, JSON.stringify(label.reasons), now, label.id, label.userId)
    .run();

  if (result.meta.changes === 0) {
    throw new Error('label not found or not owned by user');
  }
}

export async function deleteLabel(db: D1Database, userId: number, labelId: number): Promise<void> {
  const result = await db
    .prepare('DELETE FROM labels WHERE id = ? AND user_id = ?')
    .bind(labelId, userId)
    .run();

  if (result.meta.changes === 0) {
    throw new Error('label not found or not owned by user');
  }
}
