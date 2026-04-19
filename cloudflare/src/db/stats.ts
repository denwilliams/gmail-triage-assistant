import type {
  DashboardSummary,
  DashboardTimeseries,
  SenderStat,
  DomainStat,
  SlugStat,
  LabelStat,
  KeywordStat,
  DayCount,
  DayRate,
  DayLabelCount,
  HourCount,
  EmailRow,
  Bucket,
  TriageVia,
  PipelineStage,
} from '../types/models';

// ============================================================================
// Dashboard Summary
// ============================================================================

export async function getDashboardSummary(db: D1Database, userId: number): Promise<DashboardSummary> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const dayOfWeek = now.getDay(); // 0 = Sunday
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek).toISOString();

  // Counts: total, today, this week, unique senders, bypass rate, notification rate
  // Replace FILTER (WHERE ...) with SUM(CASE WHEN ...)
  const countsRow = await db
    .prepare(
      `SELECT
        COUNT(*) as total_emails,
        SUM(CASE WHEN processed_at >= ? THEN 1 ELSE 0 END) as emails_today,
        SUM(CASE WHEN processed_at >= ? THEN 1 ELSE 0 END) as emails_this_week,
        COUNT(DISTINCT from_address) as unique_senders,
        COALESCE(AVG(CASE WHEN bypassed_inbox = 1 THEN 1.0 ELSE 0.0 END), 0) as bypass_rate,
        COALESCE(AVG(CASE WHEN notification_sent = 1 THEN 1.0 ELSE 0.0 END), 0) as notification_rate
      FROM emails WHERE user_id = ?`,
    )
    .bind(todayStart, weekStart, userId)
    .first<{
      total_emails: number;
      emails_today: number;
      emails_this_week: number;
      unique_senders: number;
      bypass_rate: number;
      notification_rate: number;
    }>();

  const summary: DashboardSummary = {
    totalEmails: countsRow?.total_emails ?? 0,
    emailsToday: countsRow?.emails_today ?? 0,
    emailsThisWeek: countsRow?.emails_this_week ?? 0,
    uniqueSenders: countsRow?.unique_senders ?? 0,
    bypassRate: countsRow?.bypass_rate ?? 0,
    notificationRate: countsRow?.notification_rate ?? 0,
    topSenders: [],
    topDomains: [],
    topSlugs: [],
    labelDistribution: [],
    topKeywords: [],
    newSlugsThisWeek: 0,
    recurringSlugsThisWeek: 0,
  };

  // Top 15 senders
  const { results: senderRows } = await db
    .prepare(
      `SELECT from_address, COUNT(*) as cnt,
        AVG(CASE WHEN bypassed_inbox = 1 THEN 1.0 ELSE 0.0 END) as archive_rate
      FROM emails WHERE user_id = ?
      GROUP BY from_address ORDER BY cnt DESC LIMIT 15`,
    )
    .bind(userId)
    .all<{ from_address: string; cnt: number; archive_rate: number }>();
  summary.topSenders = senderRows.map<SenderStat>((r) => ({
    address: r.from_address,
    count: r.cnt,
    archiveRate: r.archive_rate,
  }));

  // Top 15 domains
  const { results: domainRows } = await db
    .prepare(
      `SELECT from_domain, COUNT(*) as cnt,
        AVG(CASE WHEN bypassed_inbox = 1 THEN 1.0 ELSE 0.0 END) as archive_rate
      FROM emails WHERE user_id = ? AND from_domain != ''
      GROUP BY from_domain ORDER BY cnt DESC LIMIT 15`,
    )
    .bind(userId)
    .all<{ from_domain: string; cnt: number; archive_rate: number }>();
  summary.topDomains = domainRows.map<DomainStat>((r) => ({
    domain: r.from_domain,
    count: r.cnt,
    archiveRate: r.archive_rate,
  }));

  // Top 20 slugs
  const { results: slugRows } = await db
    .prepare(
      `SELECT slug, COUNT(*) as cnt
      FROM emails WHERE user_id = ?
      GROUP BY slug ORDER BY cnt DESC LIMIT 20`,
    )
    .bind(userId)
    .all<{ slug: string; cnt: number }>();
  summary.topSlugs = slugRows.map<SlugStat>((r) => ({ slug: r.slug, count: r.cnt }));

  // Label distribution — aggregate in TypeScript since D1 has no jsonb_array_elements_text
  // Fetch raw labels_applied for last 90 days, limit 5000
  const { results: labelRows } = await db
    .prepare(
      `SELECT labels_applied FROM emails
       WHERE user_id = ? AND processed_at >= datetime('now', '-90 days')
       LIMIT 5000`,
    )
    .bind(userId)
    .all<{ labels_applied: string }>();

  const labelCounts = new Map<string, number>();
  for (const row of labelRows) {
    try {
      const labels = JSON.parse(row.labels_applied) as string[];
      for (const label of labels) {
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
    } catch {
      // skip malformed JSON
    }
  }
  summary.labelDistribution = Array.from(labelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map<LabelStat>(([label, count]) => ({ label, count }));

  // Top 50 keywords — same approach
  const { results: kwRows } = await db
    .prepare(
      `SELECT keywords FROM emails
       WHERE user_id = ? AND processed_at >= datetime('now', '-90 days')
       LIMIT 5000`,
    )
    .bind(userId)
    .all<{ keywords: string }>();

  const kwCounts = new Map<string, number>();
  for (const row of kwRows) {
    try {
      const keywords = JSON.parse(row.keywords) as string[];
      for (const kw of keywords) {
        kwCounts.set(kw, (kwCounts.get(kw) ?? 0) + 1);
      }
    } catch {
      // skip malformed JSON
    }
  }
  summary.topKeywords = Array.from(kwCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map<KeywordStat>(([keyword, count]) => ({ keyword, count }));

  // New vs recurring slugs this week
  const slugNoveltyRow = await db
    .prepare(
      `WITH this_week AS (
        SELECT DISTINCT slug FROM emails
        WHERE user_id = ? AND processed_at >= ?
      ),
      before_week AS (
        SELECT DISTINCT slug FROM emails
        WHERE user_id = ? AND processed_at < ?
      )
      SELECT
        (SELECT COUNT(*) FROM this_week WHERE slug NOT IN (SELECT slug FROM before_week)) as new_slugs,
        (SELECT COUNT(*) FROM this_week WHERE slug IN (SELECT slug FROM before_week)) as recurring_slugs`,
    )
    .bind(userId, weekStart, userId, weekStart)
    .first<{ new_slugs: number; recurring_slugs: number }>();

  summary.newSlugsThisWeek = slugNoveltyRow?.new_slugs ?? 0;
  summary.recurringSlugsThisWeek = slugNoveltyRow?.recurring_slugs ?? 0;

  return summary;
}

// ============================================================================
// Dashboard Timeseries
// ============================================================================

export async function getDashboardTimeseries(
  db: D1Database,
  userId: number,
  days: number,
): Promise<DashboardTimeseries> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const ts: DashboardTimeseries = {
    dailyVolume: [],
    dailyBypassRate: [],
    dailyNotifications: [],
    labelTrends: [],
    hourlyHeatmap: [],
  };

  // Daily email count
  const { results: volumeRows } = await db
    .prepare(
      `SELECT date(processed_at) as day, COUNT(*) as cnt
       FROM emails WHERE user_id = ? AND processed_at >= ?
       GROUP BY day ORDER BY day`,
    )
    .bind(userId, since)
    .all<{ day: string; cnt: number }>();
  ts.dailyVolume = volumeRows.map<DayCount>((r) => ({ date: r.day, count: r.cnt }));

  // Daily bypass rate
  const { results: bypassRows } = await db
    .prepare(
      `SELECT date(processed_at) as day,
        COUNT(*) as total,
        SUM(CASE WHEN bypassed_inbox = 1 THEN 1 ELSE 0 END) as bypassed,
        COALESCE(AVG(CASE WHEN bypassed_inbox = 1 THEN 1.0 ELSE 0.0 END), 0) as rate
       FROM emails WHERE user_id = ? AND processed_at >= ?
       GROUP BY day ORDER BY day`,
    )
    .bind(userId, since)
    .all<{ day: string; total: number; bypassed: number; rate: number }>();
  ts.dailyBypassRate = bypassRows.map<DayRate>((r) => ({
    date: r.day,
    total: r.total,
    count: r.bypassed,
    rate: r.rate,
  }));

  // Daily notification count
  const { results: notifRows } = await db
    .prepare(
      `SELECT date(processed_at) as day, COUNT(*) as cnt
       FROM emails WHERE user_id = ? AND processed_at >= ? AND notification_sent = 1
       GROUP BY day ORDER BY day`,
    )
    .bind(userId, since)
    .all<{ day: string; cnt: number }>();
  ts.dailyNotifications = notifRows.map<DayCount>((r) => ({ date: r.day, count: r.cnt }));

  // Label trends per day — aggregate in TypeScript
  const { results: trendRows } = await db
    .prepare(
      `SELECT date(processed_at) as day, labels_applied
       FROM emails
       WHERE user_id = ? AND processed_at >= ?`,
    )
    .bind(userId, since)
    .all<{ day: string; labels_applied: string }>();

  const labelDayCounts = new Map<string, number>(); // key = "day|label"
  for (const row of trendRows) {
    try {
      const labels = JSON.parse(row.labels_applied) as string[];
      for (const label of labels) {
        const key = `${row.day}|${label}`;
        labelDayCounts.set(key, (labelDayCounts.get(key) ?? 0) + 1);
      }
    } catch {
      // skip
    }
  }
  const trendEntries: DayLabelCount[] = [];
  for (const [key, count] of labelDayCounts) {
    const [date, label] = key.split('|');
    trendEntries.push({ date, label, count });
  }
  ts.labelTrends = trendEntries.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    return b.count - a.count;
  });

  // Hourly heatmap (all time) — use strftime for DOW and HOUR
  const { results: heatmapRows } = await db
    .prepare(
      `SELECT CAST(strftime('%w', processed_at) AS INTEGER) as dow,
              CAST(strftime('%H', processed_at) AS INTEGER) as hr,
              COUNT(*) as cnt
       FROM emails WHERE user_id = ?
       GROUP BY dow, hr ORDER BY dow, hr`,
    )
    .bind(userId)
    .all<{ dow: number; hr: number; cnt: number }>();
  ts.hourlyHeatmap = heatmapRows.map<HourCount>((r) => ({
    dayOfWeek: r.dow,
    hour: r.hr,
    count: r.cnt,
  }));

  return ts;
}

// ============================================================================
// V2 pipeline stats
// ============================================================================

export interface V2FailureRow {
  id: string;
  fromAddress: string;
  subject: string;
  bucket: Bucket | null;
  pipelineStage: PipelineStage;
  processedAt: string;
}

export interface V2PipelineStats {
  // Counts for emails processed via v2 (bucket IS NOT NULL).
  totalV2: number;
  totalV2Today: number;
  totalV2ThisWeek: number;
  // { newsletter: 12, notification: 3, ... } over the last windowDays.
  bucketCountsToday: Record<Bucket, number>;
  bucketCountsWeek: Record<Bucket, number>;
  // Triage-path distribution over the last 7d (for the fast-path ratio).
  triageViaWeek: Record<TriageVia, number>;
  // Pipeline stage distribution (current state of the table).
  stageCounts: Record<PipelineStage, number>;
  // How many emails were included in a daily digest over last 7d.
  digestIncludedWeek: number;
  // Recent failures — handy for an ops glance.
  recentFailures: V2FailureRow[];
}

const EMPTY_BUCKET_COUNTS: Record<Bucket, number> = {
  newsletter: 0,
  notification: 0,
  human: 0,
  transactional: 0,
  security: 0,
  calendar: 0,
};

const EMPTY_TRIAGE_VIA: Record<TriageVia, number> = {
  ai: 0,
  thread_reply: 0,
  consistent_sender: 0,
};

const EMPTY_STAGE_COUNTS: Record<PipelineStage, number> = {
  queued: 0,
  bucketed: 0,
  processed: 0,
  failed: 0,
};

export async function getV2PipelineStats(
  db: D1Database,
  userId: number,
): Promise<V2PipelineStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Totals for v2 emails (bucket IS NOT NULL)
  const totalsRow = await db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN processed_at >= ? THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN processed_at >= ? THEN 1 ELSE 0 END) as week
       FROM emails
       WHERE user_id = ? AND bucket IS NOT NULL`,
    )
    .bind(todayStart, weekStart, userId)
    .first<{ total: number; today: number; week: number }>();

  // Per-bucket counts, today
  const { results: todayBucketRows } = await db
    .prepare(
      `SELECT bucket, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket IS NOT NULL AND processed_at >= ?
       GROUP BY bucket`,
    )
    .bind(userId, todayStart)
    .all<{ bucket: string; cnt: number }>();

  // Per-bucket counts, last 7d
  const { results: weekBucketRows } = await db
    .prepare(
      `SELECT bucket, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket IS NOT NULL AND processed_at >= ?
       GROUP BY bucket`,
    )
    .bind(userId, weekStart)
    .all<{ bucket: string; cnt: number }>();

  // Triage-path distribution, last 7d
  const { results: triageRows } = await db
    .prepare(
      `SELECT triage_via, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND triage_via IS NOT NULL AND processed_at >= ?
       GROUP BY triage_via`,
    )
    .bind(userId, weekStart)
    .all<{ triage_via: string; cnt: number }>();

  // Pipeline stage distribution (all-time among v2 rows)
  const { results: stageRows } = await db
    .prepare(
      `SELECT pipeline_stage, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket IS NOT NULL
       GROUP BY pipeline_stage`,
    )
    .bind(userId)
    .all<{ pipeline_stage: string; cnt: number }>();

  // Digest inclusions, last 7d
  const digestRow = await db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND included_in_digest IS NOT NULL AND processed_at >= ?`,
    )
    .bind(userId, weekStart)
    .first<{ cnt: number }>();

  // Recent failures
  const { results: failureRows } = await db
    .prepare(
      `SELECT id, from_address, subject, bucket, pipeline_stage, processed_at
       FROM emails
       WHERE user_id = ? AND pipeline_stage = 'failed'
       ORDER BY processed_at DESC
       LIMIT 10`,
    )
    .bind(userId)
    .all<{
      id: string;
      from_address: string;
      subject: string;
      bucket: string | null;
      pipeline_stage: string;
      processed_at: string;
    }>();

  const bucketCountsToday = { ...EMPTY_BUCKET_COUNTS };
  for (const r of todayBucketRows) {
    if (r.bucket in bucketCountsToday) {
      bucketCountsToday[r.bucket as Bucket] = r.cnt;
    }
  }
  const bucketCountsWeek = { ...EMPTY_BUCKET_COUNTS };
  for (const r of weekBucketRows) {
    if (r.bucket in bucketCountsWeek) {
      bucketCountsWeek[r.bucket as Bucket] = r.cnt;
    }
  }

  const triageViaWeek = { ...EMPTY_TRIAGE_VIA };
  for (const r of triageRows) {
    if (r.triage_via in triageViaWeek) {
      triageViaWeek[r.triage_via as TriageVia] = r.cnt;
    }
  }

  const stageCounts = { ...EMPTY_STAGE_COUNTS };
  for (const r of stageRows) {
    if (r.pipeline_stage in stageCounts) {
      stageCounts[r.pipeline_stage as PipelineStage] = r.cnt;
    }
  }

  return {
    totalV2: totalsRow?.total ?? 0,
    totalV2Today: totalsRow?.today ?? 0,
    totalV2ThisWeek: totalsRow?.week ?? 0,
    bucketCountsToday,
    bucketCountsWeek,
    triageViaWeek,
    stageCounts,
    digestIncludedWeek: digestRow?.cnt ?? 0,
    recentFailures: failureRows.map<V2FailureRow>((r) => ({
      id: r.id,
      fromAddress: r.from_address,
      subject: r.subject,
      bucket: (r.bucket as Bucket | null) ?? null,
      pipelineStage: r.pipeline_stage as PipelineStage,
      processedAt: r.processed_at,
    })),
  };
}
