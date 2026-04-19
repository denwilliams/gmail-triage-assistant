import type {
  DailyDigest,
  DailyDigestRow,
  DigestItemCounts,
  DigestSections,
} from '../types/models';

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function mapDigest(row: DailyDigestRow): DailyDigest {
  return {
    id: row.id,
    userId: row.user_id,
    digestDate: row.digest_date,
    contentHtml: row.content_html,
    contentText: row.content_text,
    sections: safeParse<DigestSections>(row.sections, {
      newsletters: [],
      notifications: [],
      quietHumans: [],
    }),
    itemCounts: safeParse<DigestItemCounts>(row.item_counts, {
      newsletters: 0,
      notifications: 0,
      quietHumans: 0,
    }),
    sentAt: row.sent_at,
    gmailMessageId: row.gmail_message_id,
    createdAt: row.created_at,
  };
}

const SELECT_COLS = `id, user_id, digest_date, content_html, content_text,
       sections, item_counts, sent_at, gmail_message_id, created_at`;

export async function upsertDigest(
  db: D1Database,
  params: {
    userId: number;
    digestDate: string;
    contentHtml: string;
    contentText: string;
    sections: DigestSections;
    itemCounts: DigestItemCounts;
    sentAt: string | null;
    gmailMessageId: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_digests
        (user_id, digest_date, content_html, content_text, sections, item_counts, sent_at, gmail_message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, digest_date)
       DO UPDATE SET
         content_html = excluded.content_html,
         content_text = excluded.content_text,
         sections = excluded.sections,
         item_counts = excluded.item_counts,
         sent_at = excluded.sent_at,
         gmail_message_id = excluded.gmail_message_id`,
    )
    .bind(
      params.userId,
      params.digestDate,
      params.contentHtml,
      params.contentText,
      JSON.stringify(params.sections),
      JSON.stringify(params.itemCounts),
      params.sentAt,
      params.gmailMessageId,
    )
    .run();
}

export async function getDigestByDate(
  db: D1Database,
  userId: number,
  digestDate: string,
): Promise<DailyDigest | null> {
  const row = await db
    .prepare(`SELECT ${SELECT_COLS} FROM daily_digests WHERE user_id = ? AND digest_date = ?`)
    .bind(userId, digestDate)
    .first<DailyDigestRow>();
  return row ? mapDigest(row) : null;
}

export async function listDigests(
  db: D1Database,
  userId: number,
  limit: number,
  offset: number,
): Promise<DailyDigest[]> {
  const { results } = await db
    .prepare(
      `SELECT ${SELECT_COLS}
       FROM daily_digests
       WHERE user_id = ?
       ORDER BY digest_date DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(userId, limit, offset)
    .all<DailyDigestRow>();
  return results.map(mapDigest);
}
