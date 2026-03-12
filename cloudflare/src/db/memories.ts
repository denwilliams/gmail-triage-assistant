import type { Memory, MemoryRow, MemoryType } from '../types/models';

function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as MemoryType,
    content: row.content,
    reasoning: row.reasoning,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
}

export async function createMemory(
  db: D1Database,
  memory: Omit<Memory, 'id'>,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO memories (user_id, type, content, reasoning, start_date, end_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      memory.userId,
      memory.type,
      memory.content,
      memory.reasoning,
      memory.startDate,
      memory.endDate,
      memory.createdAt,
    )
    .first<{ id: number }>();
  if (!row) throw new Error('Failed to create memory');
  return row.id;
}

export async function getMemoriesByType(
  db: D1Database,
  userId: number,
  memoryType: MemoryType,
  limit: number,
): Promise<Memory[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, type, content, reasoning, start_date, end_date, created_at
       FROM memories
       WHERE user_id = ? AND type = ?
       ORDER BY start_date DESC
       LIMIT ?`,
    )
    .bind(userId, memoryType, limit)
    .all<MemoryRow>();
  return results.map(mapMemory);
}

export async function getAllMemories(
  db: D1Database,
  userId: number,
  limit: number,
): Promise<Memory[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, type, content, reasoning, start_date, end_date, created_at
       FROM memories
       WHERE user_id = ?
       ORDER BY start_date DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<MemoryRow>();
  return results.map(mapMemory);
}

/**
 * Retrieves the most relevant memories for AI context.
 * Returns: 1 yearly, 1 monthly, 1 weekly, and up to 7 daily memories.
 * Uses 4 separate queries instead of UNION ALL (D1 compatibility).
 */
export async function getRecentMemoriesForContext(
  db: D1Database,
  userId: number,
): Promise<Memory[]> {
  const baseQuery = `SELECT id, user_id, type, content, reasoning, start_date, end_date, created_at
     FROM memories WHERE user_id = ? AND type = ? ORDER BY start_date DESC LIMIT ?`;

  const [yearly, monthly, weekly, daily] = await Promise.all([
    db.prepare(baseQuery).bind(userId, 'yearly', 1).all<MemoryRow>(),
    db.prepare(baseQuery).bind(userId, 'monthly', 1).all<MemoryRow>(),
    db.prepare(baseQuery).bind(userId, 'weekly', 1).all<MemoryRow>(),
    db.prepare(baseQuery).bind(userId, 'daily', 7).all<MemoryRow>(),
  ]);

  // Merge in order: yearly, monthly, weekly, daily (each sorted by start_date desc)
  const all = [
    ...yearly.results,
    ...monthly.results,
    ...weekly.results,
    ...daily.results,
  ];

  return all.map(mapMemory);
}

export async function getMemoriesByDateRange(
  db: D1Database,
  userId: number,
  memoryType: MemoryType,
  startDate: string,
  endDate: string,
): Promise<Memory[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, type, content, reasoning, start_date, end_date, created_at
       FROM memories
       WHERE user_id = ? AND type = ? AND start_date >= ? AND start_date < ?
       ORDER BY start_date ASC`,
    )
    .bind(userId, memoryType, startDate, endDate)
    .all<MemoryRow>();
  return results.map(mapMemory);
}
