import type { WrapupReport } from '../types'

export async function createWrapupReport(
  db: D1Database, report: Omit<WrapupReport, 'id' | 'created_at'>
): Promise<void> {
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO wrapup_reports (user_id, report_type, email_count, content, generated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(report.user_id, report.report_type, report.email_count, report.content, report.generated_at, now).run()
}

export async function getWrapupReports(db: D1Database, userId: number, limit = 30): Promise<WrapupReport[]> {
  const result = await db.prepare(`
    SELECT * FROM wrapup_reports WHERE user_id = ? ORDER BY generated_at DESC LIMIT ?
  `).bind(userId, limit).all<WrapupReport>()
  return result.results
}
