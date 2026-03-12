import type { WrapupReport, WrapupReportRow } from '../types/models';

function mapWrapupReport(row: WrapupReportRow): WrapupReport {
  return {
    id: row.id,
    userId: row.user_id,
    reportType: row.report_type,
    content: row.content,
    emailCount: row.email_count,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

export async function createWrapupReport(
  db: D1Database,
  report: Omit<WrapupReport, 'id' | 'createdAt'>,
): Promise<WrapupReport> {
  const row = await db
    .prepare(
      `INSERT INTO wrapup_reports (user_id, report_type, content, email_count, generated_at, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       RETURNING *`,
    )
    .bind(
      report.userId,
      report.reportType,
      report.content,
      report.emailCount,
      report.generatedAt,
    )
    .first<WrapupReportRow>();

  if (!row) throw new Error('Failed to create wrapup report');
  return mapWrapupReport(row);
}

export async function getWrapupReportsByUser(
  db: D1Database,
  userId: number,
  limit: number,
): Promise<WrapupReport[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, report_type, content, email_count, generated_at, created_at
       FROM wrapup_reports
       WHERE user_id = ?
       ORDER BY generated_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<WrapupReportRow>();
  return results.map(mapWrapupReport);
}

export async function getWrapupReportsByType(
  db: D1Database,
  userId: number,
  reportType: string,
  limit: number,
): Promise<WrapupReport[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, report_type, content, email_count, generated_at, created_at
       FROM wrapup_reports
       WHERE user_id = ? AND report_type = ?
       ORDER BY generated_at DESC
       LIMIT ?`,
    )
    .bind(userId, reportType, limit)
    .all<WrapupReportRow>();
  return results.map(mapWrapupReport);
}
