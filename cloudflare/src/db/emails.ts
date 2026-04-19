import type {
  Bucket,
  Email,
  EmailRow,
  PipelineStage,
  TriageVia,
} from '../types/models';

// Full column list — used by every SELECT so the row shape is consistent.
const EMAIL_COLUMNS = `id, user_id, from_address, from_domain, subject, slug, keywords, summary,
       labels_applied, bypassed_inbox, reasoning, human_feedback,
       feedback_dirty, notification_sent, draft_created, processed_at, created_at,
       bucket, pipeline_stage, triage_reasoning, triage_via, severity, urgency,
       interesting_score, interesting_reasons, in_reply_to, thread_id, included_in_digest`;

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function mapEmail(row: EmailRow): Email {
  return {
    id: row.id,
    userId: row.user_id,
    fromAddress: row.from_address,
    fromDomain: row.from_domain,
    subject: row.subject,
    slug: row.slug,
    keywords: safeParseJSON<string[]>(row.keywords, []),
    summary: row.summary,
    labelsApplied: safeParseJSON<string[]>(row.labels_applied, []),
    bypassedInbox: row.bypassed_inbox === 1,
    reasoning: row.reasoning,
    humanFeedback: row.human_feedback,
    feedbackDirty: row.feedback_dirty === 1,
    notificationSent: row.notification_sent === 1,
    draftCreated: row.draft_created === 1,
    processedAt: row.processed_at,
    createdAt: row.created_at,
    bucket: (row.bucket as Bucket | null) ?? null,
    pipelineStage: (row.pipeline_stage as PipelineStage) ?? 'queued',
    triageReasoning: row.triage_reasoning,
    triageVia: (row.triage_via as TriageVia | null) ?? null,
    severity: row.severity,
    urgency: row.urgency,
    interestingScore: row.interesting_score,
    interestingReasons: safeParseJSON<string[]>(row.interesting_reasons ?? '[]', []),
    inReplyTo: row.in_reply_to,
    threadId: row.thread_id,
    includedInDigest: row.included_in_digest,
  };
}

export async function emailExists(db: D1Database, emailId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM emails WHERE id = ?')
    .bind(emailId)
    .first<{ '1': number }>();
  return row !== null;
}

export async function getEmailByID(db: D1Database, emailId: string): Promise<Email | null> {
  const row = await db
    .prepare(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE id = ?`)
    .bind(emailId)
    .first<EmailRow>();
  return row ? mapEmail(row) : null;
}

export async function createEmail(db: D1Database, email: Email): Promise<void> {
  await db
    .prepare(
      `INSERT INTO emails (id, user_id, from_address, from_domain, subject, slug, keywords, summary,
        labels_applied, bypassed_inbox, reasoning, notification_sent, draft_created, processed_at, created_at,
        bucket, pipeline_stage, triage_reasoning, triage_via, severity, urgency,
        interesting_score, interesting_reasons, in_reply_to, thread_id, included_in_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      email.id,
      email.userId,
      email.fromAddress,
      email.fromDomain,
      email.subject,
      email.slug,
      JSON.stringify(email.keywords),
      email.summary,
      JSON.stringify(email.labelsApplied),
      email.bypassedInbox ? 1 : 0,
      email.reasoning,
      email.notificationSent ? 1 : 0,
      email.draftCreated ? 1 : 0,
      email.processedAt,
      email.createdAt,
      email.bucket,
      email.pipelineStage,
      email.triageReasoning,
      email.triageVia,
      email.severity,
      email.urgency,
      email.interestingScore,
      JSON.stringify(email.interestingReasons ?? []),
      email.inReplyTo,
      email.threadId,
      email.includedInDigest,
    )
    .run();
}

/**
 * Create the initial email row after stage 1 triage, before bucket processing.
 * The bucket processor finishes populating the row via updateEmailAfterProcessing.
 */
export async function createEmailStub(
  db: D1Database,
  params: {
    id: string;
    userId: number;
    fromAddress: string;
    fromDomain: string;
    subject: string;
    bucket: Bucket | null;
    triageReasoning: string;
    triageVia: TriageVia;
    inReplyTo: string | null;
    threadId: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO emails (id, user_id, from_address, from_domain, subject, slug, keywords, summary,
        labels_applied, bypassed_inbox, reasoning, notification_sent, draft_created, processed_at, created_at,
        bucket, pipeline_stage, triage_reasoning, triage_via, interesting_reasons,
        in_reply_to, thread_id)
       VALUES (?, ?, ?, ?, ?, '', '[]', '',
               '[]', 0, '', 0, 0, ?, ?,
               ?, 'bucketed', ?, ?, '[]',
               ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(
      params.id,
      params.userId,
      params.fromAddress,
      params.fromDomain,
      params.subject,
      now,
      now,
      params.bucket,
      params.triageReasoning,
      params.triageVia,
      params.inReplyTo,
      params.threadId,
    )
    .run();
}

/**
 * Finalise an email row after its bucket processor has run.
 * Leaves triage/thread fields untouched — those were set by createEmailStub.
 */
export async function finaliseEmail(
  db: D1Database,
  email: Email,
  stage: PipelineStage = 'processed',
): Promise<void> {
  await db
    .prepare(
      `UPDATE emails SET
        slug = ?, keywords = ?, summary = ?, labels_applied = ?,
        bypassed_inbox = ?, reasoning = ?, notification_sent = ?, draft_created = ?,
        severity = ?, urgency = ?, interesting_score = ?, interesting_reasons = ?,
        pipeline_stage = ?, processed_at = ?
       WHERE id = ?`,
    )
    .bind(
      email.slug,
      JSON.stringify(email.keywords),
      email.summary,
      JSON.stringify(email.labelsApplied),
      email.bypassedInbox ? 1 : 0,
      email.reasoning,
      email.notificationSent ? 1 : 0,
      email.draftCreated ? 1 : 0,
      email.severity,
      email.urgency,
      email.interestingScore,
      JSON.stringify(email.interestingReasons ?? []),
      stage,
      email.processedAt,
      email.id,
    )
    .run();
}

export async function markIncludedInDigest(
  db: D1Database,
  emailIds: string[],
  digestDate: string,
): Promise<void> {
  if (emailIds.length === 0) return;
  const placeholders = emailIds.map(() => '?').join(',');
  await db
    .prepare(`UPDATE emails SET included_in_digest = ? WHERE id IN (${placeholders})`)
    .bind(digestDate, ...emailIds)
    .run();
}

export async function getRecentEmails(
  db: D1Database,
  userId: number,
  limit: number,
  offset: number,
  bucket?: Bucket,
): Promise<Email[]> {
  if (bucket) {
    const { results } = await db
      .prepare(
        `SELECT ${EMAIL_COLUMNS}
         FROM emails
         WHERE user_id = ? AND bucket = ?
         ORDER BY processed_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(userId, bucket, limit, offset)
      .all<EmailRow>();
    return results.map(mapEmail);
  }
  const { results } = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ?
       ORDER BY processed_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function updateEmailFeedback(
  db: D1Database,
  userId: number,
  emailId: string,
  feedback: string,
): Promise<void> {
  const result = await db
    .prepare(
      `UPDATE emails SET human_feedback = ?, feedback_dirty = (? != '')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(feedback, feedback, emailId, userId)
    .run();

  if (result.meta.changes === 0) {
    throw new Error('email not found or unauthorized');
  }
}

export async function getUserLabels(db: D1Database, userId: number): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT name FROM labels WHERE user_id = ? ORDER BY name')
    .bind(userId)
    .all<{ name: string }>();
  return results.map((r) => r.name);
}

export async function getEmailsByDateRange(
  db: D1Database,
  userId: number,
  startDate: string,
  endDate: string,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ? AND processed_at >= ? AND processed_at < ?
       ORDER BY processed_at ASC`,
    )
    .bind(userId, startDate, endDate)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function getEmailsByBucket(
  db: D1Database,
  userId: number,
  bucket: Bucket,
  startDate: string,
  endDate: string,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ? AND bucket = ? AND processed_at >= ? AND processed_at < ?
       ORDER BY processed_at ASC`,
    )
    .bind(userId, bucket, startDate, endDate)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function getEmailsWithDirtyFeedback(db: D1Database, userId: number): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ? AND feedback_dirty = 1
       ORDER BY processed_at ASC`,
    )
    .bind(userId)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function clearFeedbackDirty(db: D1Database, userId: number, _emailIds: string[]): Promise<void> {
  if (_emailIds.length === 0) return;
  await db
    .prepare('UPDATE emails SET feedback_dirty = 0 WHERE user_id = ? AND feedback_dirty = 1')
    .bind(userId)
    .run();
}

export async function getHistoricalEmailsFromAddress(
  db: D1Database,
  userId: number,
  address: string,
  limit: number,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ? AND from_address = ?
       ORDER BY processed_at DESC
       LIMIT ?`,
    )
    .bind(userId, address, limit)
    .all<EmailRow>();
  return results.map(mapEmail);
}

export async function getHistoricalEmailsFromDomain(
  db: D1Database,
  userId: number,
  domain: string,
  limit: number,
): Promise<Email[]> {
  const { results } = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ? AND from_domain = ?
       ORDER BY processed_at DESC
       LIMIT ?`,
    )
    .bind(userId, domain, limit)
    .all<EmailRow>();
  return results.map(mapEmail);
}

/**
 * Find a prior email that started the thread of `inReplyToHeader` (the
 * Message-Id referenced by the new email's In-Reply-To header). Used by the
 * triage fast path to inherit the bucket.
 */
export async function findEmailByMessageId(
  db: D1Database,
  userId: number,
  messageId: string,
): Promise<Email | null> {
  const row = await db
    .prepare(`SELECT ${EMAIL_COLUMNS} FROM emails WHERE user_id = ? AND id = ?`)
    .bind(userId, messageId)
    .first<EmailRow>();
  return row ? mapEmail(row) : null;
}

/**
 * Return the most recently processed email in a Gmail thread.
 */
export async function findLatestEmailInThread(
  db: D1Database,
  userId: number,
  threadId: string,
): Promise<Email | null> {
  const row = await db
    .prepare(
      `SELECT ${EMAIL_COLUMNS}
       FROM emails
       WHERE user_id = ? AND thread_id = ?
       ORDER BY processed_at DESC
       LIMIT 1`,
    )
    .bind(userId, threadId)
    .first<EmailRow>();
  return row ? mapEmail(row) : null;
}
