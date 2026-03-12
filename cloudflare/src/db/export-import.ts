import type {
  ExportData,
  ExportEnvelope,
  ExportLabel,
  ExportSystemPrompt,
  ExportAIPrompt,
  ExportMemory,
  ExportSenderProfile,
  ExportEmail,
  ExportWrapupReport,
  ExportNotification,
  ImportResult,
  LabelRow,
  SystemPromptRow,
  AIPromptRow,
  MemoryRow,
  SenderProfileRow,
  EmailRow,
  WrapupReportRow,
  NotificationRow,
} from '../types/models';
import { extractDomain } from './sender-profiles';

// ============================================================================
// Export functions
// ============================================================================

export async function exportLabels(db: D1Database, userId: number): Promise<ExportLabel[]> {
  const { results } = await db
    .prepare(
      `SELECT name, COALESCE(description, '') as description, reasons
       FROM labels WHERE user_id = ? ORDER BY name`,
    )
    .bind(userId)
    .all<{ name: string; description: string; reasons: string }>();

  return results.map((r) => {
    let reasons: string[] = [];
    try { reasons = JSON.parse(r.reasons) as string[]; } catch { /* empty */ }
    return { name: r.name, description: r.description, reasons };
  });
}

export async function exportSystemPrompts(db: D1Database, userId: number): Promise<ExportSystemPrompt[]> {
  const { results } = await db
    .prepare('SELECT type, content FROM system_prompts WHERE user_id = ? ORDER BY type')
    .bind(userId)
    .all<{ type: string; content: string }>();
  return results.map((r) => ({ type: r.type as ExportSystemPrompt['type'], content: r.content }));
}

export async function exportAIPrompts(db: D1Database, userId: number): Promise<ExportAIPrompt[]> {
  const { results } = await db
    .prepare('SELECT type, content, version, created_at FROM ai_prompts WHERE user_id = ? ORDER BY type, version')
    .bind(userId)
    .all<{ type: string; content: string; version: number; created_at: string }>();
  return results.map((r) => ({
    type: r.type as ExportAIPrompt['type'],
    content: r.content,
    version: r.version,
    createdAt: r.created_at,
  }));
}

export async function exportMemories(db: D1Database, userId: number): Promise<ExportMemory[]> {
  const { results } = await db
    .prepare(
      `SELECT type, content, reasoning, start_date, end_date, created_at
       FROM memories WHERE user_id = ? ORDER BY start_date`,
    )
    .bind(userId)
    .all<{ type: string; content: string; reasoning: string; start_date: string; end_date: string; created_at: string }>();
  return results.map((r) => ({
    type: r.type as ExportMemory['type'],
    content: r.content,
    reasoning: r.reasoning,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: r.created_at,
  }));
}

export async function exportSenderProfiles(db: D1Database, userId: number): Promise<ExportSenderProfile[]> {
  const { results } = await db
    .prepare(
      `SELECT profile_type, identifier,
              email_count, emails_archived, emails_notified,
              slug_counts, label_counts, keyword_counts,
              sender_type, summary, first_seen_at, last_seen_at
       FROM sender_profiles WHERE user_id = ? ORDER BY identifier`,
    )
    .bind(userId)
    .all<{
      profile_type: string; identifier: string;
      email_count: number; emails_archived: number; emails_notified: number;
      slug_counts: string; label_counts: string; keyword_counts: string;
      sender_type: string; summary: string; first_seen_at: string; last_seen_at: string;
    }>();

  return results.map((r) => {
    const safeJSON = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
    return {
      profileType: r.profile_type as ExportSenderProfile['profileType'],
      identifier: r.identifier,
      emailCount: r.email_count,
      emailsArchived: r.emails_archived,
      emailsNotified: r.emails_notified,
      slugCounts: safeJSON<Record<string, number>>(r.slug_counts, {}),
      labelCounts: safeJSON<Record<string, number>>(r.label_counts, {}),
      keywordCounts: safeJSON<Record<string, number>>(r.keyword_counts, {}),
      senderType: r.sender_type,
      summary: r.summary,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    };
  });
}

export async function exportEmails(db: D1Database, userId: number): Promise<ExportEmail[]> {
  const { results } = await db
    .prepare(
      `SELECT id, from_address, from_domain, subject, slug, keywords, summary,
              labels_applied, bypassed_inbox, reasoning,
              COALESCE(human_feedback, '') as human_feedback,
              COALESCE(feedback_dirty, 0) as feedback_dirty,
              notification_sent, processed_at, created_at
       FROM emails WHERE user_id = ? ORDER BY processed_at`,
    )
    .bind(userId)
    .all<EmailRow>();

  return results.map((r) => {
    const safeJSON = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };
    return {
      id: r.id,
      fromAddress: r.from_address,
      fromDomain: r.from_domain,
      subject: r.subject,
      slug: r.slug,
      keywords: safeJSON<string[]>(r.keywords, []),
      summary: r.summary,
      labelsApplied: safeJSON<string[]>(r.labels_applied, []),
      bypassedInbox: r.bypassed_inbox === 1,
      reasoning: r.reasoning,
      humanFeedback: r.human_feedback ?? '',
      feedbackDirty: (r.feedback_dirty ?? 0) === 1,
      notificationSent: r.notification_sent === 1,
      processedAt: r.processed_at,
      createdAt: r.created_at,
    };
  });
}

export async function exportWrapupReports(db: D1Database, userId: number): Promise<ExportWrapupReport[]> {
  const { results } = await db
    .prepare(
      `SELECT report_type, content, email_count, generated_at
       FROM wrapup_reports WHERE user_id = ? ORDER BY generated_at`,
    )
    .bind(userId)
    .all<{ report_type: string; content: string; email_count: number; generated_at: string }>();
  return results.map((r) => ({
    reportType: r.report_type,
    content: r.content,
    emailCount: r.email_count,
    generatedAt: r.generated_at,
  }));
}

export async function exportNotifications(db: D1Database, userId: number): Promise<ExportNotification[]> {
  const { results } = await db
    .prepare(
      `SELECT email_id, from_address, subject, message, sent_at
       FROM notifications WHERE user_id = ? ORDER BY sent_at`,
    )
    .bind(userId)
    .all<{ email_id: string; from_address: string; subject: string; message: string; sent_at: string }>();
  return results.map((r) => ({
    emailId: r.email_id,
    fromAddress: r.from_address,
    subject: r.subject,
    message: r.message,
    sentAt: r.sent_at,
  }));
}

/**
 * Export all data for a user, returning a full envelope.
 */
export async function exportAllData(
  db: D1Database,
  userId: number,
  includeEmails = false,
): Promise<ExportEnvelope> {
  const [labels, systemPrompts, aiPrompts, memories, senderProfiles, wrapupReports, notifications] =
    await Promise.all([
      exportLabels(db, userId),
      exportSystemPrompts(db, userId),
      exportAIPrompts(db, userId),
      exportMemories(db, userId),
      exportSenderProfiles(db, userId),
      exportWrapupReports(db, userId),
      exportNotifications(db, userId),
    ]);

  const data: ExportData = {
    labels,
    systemPrompts,
    aiPrompts,
    memories,
    senderProfiles,
    wrapupReports,
    notifications,
  };

  if (includeEmails) {
    data.emails = await exportEmails(db, userId);
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'gmail-triage-assistant',
    includeEmails,
    data,
  };
}

// ============================================================================
// Import functions — use D1 batch for atomicity (no interactive transactions)
// ============================================================================

export async function importAllData(
  db: D1Database,
  userId: number,
  data: ExportData,
): Promise<ImportResult> {
  const result: ImportResult = {
    labels: 0,
    systemPrompts: 0,
    aiPrompts: 0,
    memories: 0,
    senderProfiles: 0,
    wrapupReports: 0,
    notifications: 0,
    emails: 0,
  };

  const stmts: D1PreparedStatement[] = [];

  // Labels
  const now = new Date().toISOString();
  for (const l of data.labels ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO labels (user_id, name, description, reasons, created_at, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT (user_id, name)
           DO UPDATE SET description = excluded.description, reasons = excluded.reasons, updated_at = datetime('now')`,
        )
        .bind(userId, l.name, l.description, JSON.stringify(l.reasons)),
    );
    result.labels++;
  }

  // System prompts
  for (const p of data.systemPrompts ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO system_prompts (user_id, type, content, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))
           ON CONFLICT (user_id, type)
           DO UPDATE SET content = excluded.content, is_active = 1, updated_at = datetime('now')`,
        )
        .bind(userId, p.type, p.content),
    );
    result.systemPrompts++;
  }

  // AI prompts — ON CONFLICT DO NOTHING
  for (const p of data.aiPrompts ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO ai_prompts (user_id, type, content, version, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (user_id, type, version) DO NOTHING`,
        )
        .bind(userId, p.type, p.content, p.version, p.createdAt),
    );
    result.aiPrompts++;
  }

  // Memories — use INSERT OR IGNORE with a uniqueness trick
  // Since memories don't have a unique constraint on (user_id, type, start_date, end_date),
  // we check existence via a subquery in the WHERE clause
  for (const m of data.memories ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO memories (user_id, type, content, reasoning, start_date, end_date, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM memories WHERE user_id = ? AND type = ? AND start_date = ? AND end_date = ?
           )`,
        )
        .bind(
          userId, m.type, m.content, m.reasoning, m.startDate, m.endDate, m.createdAt,
          userId, m.type, m.startDate, m.endDate,
        ),
    );
    result.memories++;
  }

  // Sender profiles
  for (const p of data.senderProfiles ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO sender_profiles (
            user_id, profile_type, identifier,
            email_count, emails_archived, emails_notified,
            slug_counts, label_counts, keyword_counts,
            sender_type, summary,
            first_seen_at, last_seen_at, modified_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT (user_id, profile_type, identifier)
          DO UPDATE SET
            email_count = excluded.email_count,
            emails_archived = excluded.emails_archived,
            emails_notified = excluded.emails_notified,
            slug_counts = excluded.slug_counts,
            label_counts = excluded.label_counts,
            keyword_counts = excluded.keyword_counts,
            sender_type = excluded.sender_type,
            summary = excluded.summary,
            last_seen_at = excluded.last_seen_at,
            modified_at = datetime('now')`,
        )
        .bind(
          userId, p.profileType, p.identifier,
          p.emailCount, p.emailsArchived, p.emailsNotified,
          JSON.stringify(p.slugCounts), JSON.stringify(p.labelCounts), JSON.stringify(p.keywordCounts),
          p.senderType, p.summary,
          p.firstSeenAt, p.lastSeenAt,
        ),
    );
    result.senderProfiles++;
  }

  // Emails
  for (const e of data.emails ?? []) {
    const domain = e.fromDomain || extractDomain(e.fromAddress);
    stmts.push(
      db
        .prepare(
          `INSERT INTO emails (id, user_id, from_address, from_domain, subject, slug, keywords, summary,
                               labels_applied, bypassed_inbox, reasoning, human_feedback,
                               feedback_dirty, notification_sent, processed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id)
           DO UPDATE SET
             from_address = excluded.from_address,
             from_domain = excluded.from_domain,
             subject = excluded.subject,
             slug = excluded.slug,
             keywords = excluded.keywords,
             summary = excluded.summary,
             labels_applied = excluded.labels_applied,
             bypassed_inbox = excluded.bypassed_inbox,
             reasoning = excluded.reasoning,
             human_feedback = excluded.human_feedback,
             feedback_dirty = excluded.feedback_dirty,
             notification_sent = excluded.notification_sent`,
        )
        .bind(
          e.id, userId, e.fromAddress, domain, e.subject, e.slug,
          JSON.stringify(e.keywords), e.summary, JSON.stringify(e.labelsApplied),
          e.bypassedInbox ? 1 : 0, e.reasoning, e.humanFeedback,
          e.feedbackDirty ? 1 : 0, e.notificationSent ? 1 : 0,
          e.processedAt, e.createdAt,
        ),
    );
    result.emails++;
  }

  // Wrapup reports — use INSERT ... WHERE NOT EXISTS
  for (const r of data.wrapupReports ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO wrapup_reports (user_id, report_type, content, email_count, generated_at, created_at)
           SELECT ?, ?, ?, ?, ?, datetime('now')
           WHERE NOT EXISTS (
             SELECT 1 FROM wrapup_reports WHERE user_id = ? AND report_type = ? AND generated_at = ?
           )`,
        )
        .bind(
          userId, r.reportType, r.content, r.emailCount, r.generatedAt,
          userId, r.reportType, r.generatedAt,
        ),
    );
    result.wrapupReports++;
  }

  // Notifications — use INSERT ... WHERE NOT EXISTS
  for (const n of data.notifications ?? []) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO notifications (user_id, email_id, from_address, subject, message, sent_at, created_at)
           SELECT ?, ?, ?, ?, ?, ?, datetime('now')
           WHERE NOT EXISTS (
             SELECT 1 FROM notifications WHERE user_id = ? AND email_id = ? AND sent_at = ?
           )`,
        )
        .bind(
          userId, n.emailId, n.fromAddress, n.subject, n.message, n.sentAt,
          userId, n.emailId, n.sentAt,
        ),
    );
    result.notifications++;
  }

  // Execute all statements in a single atomic batch
  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  return result;
}
