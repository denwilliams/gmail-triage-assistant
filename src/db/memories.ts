import type { Memory, MemoryType } from '../types'

export async function createMemory(db: D1Database, memory: Omit<Memory, 'id' | 'created_at'>): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO memories (user_id, type, content, start_date, end_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(memory.user_id, memory.type, memory.content, memory.start_date, memory.end_date, now).run()
}

export async function getMemoriesByType(
  db: D1Database, userId: number, type: MemoryType, limit = 1
): Promise<Memory[]> {
  const result = await db.prepare(`
    SELECT * FROM memories WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, type, limit).all<Memory>()
  return result.results
}

export async function getMemoriesByDateRange(
  db: D1Database, userId: number, type: MemoryType, start: string, end: string
): Promise<Memory[]> {
  const result = await db.prepare(`
    SELECT * FROM memories WHERE user_id = ? AND type = ? AND start_date >= ? AND end_date <= ?
    ORDER BY created_at ASC
  `).bind(userId, type, start, end).all<Memory>()
  return result.results
}

export async function getRecentMemoriesForContext(db: D1Database, userId: number): Promise<Memory[]> {
  const results: Memory[] = []
  for (const [type, limit] of [['yearly', 1], ['monthly', 1], ['weekly', 1], ['daily', 7]] as const) {
    const memories = await getMemoriesByType(db, userId, type, limit)
    results.push(...memories)
  }
  return results
}

export async function getAllMemories(db: D1Database, userId: number, limit = 100): Promise<Memory[]> {
  const result = await db.prepare(`
    SELECT * FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).bind(userId, limit).all<Memory>()
  return result.results
}
