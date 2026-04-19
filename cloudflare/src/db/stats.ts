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

// ============================================================================
// Per-bucket stats — one shape per bucket, dispatched by getBucketStats().
// ============================================================================

export interface BucketTotals {
  allTime: number;
  month: number;
  week: number;
}

export interface EmailRef {
  id: string;
  subject: string;
  fromAddress: string;
  processedAt: string;
}

// --- Newsletter --------------------------------------------------------------

export interface NewsletterSenderStat {
  address: string;
  count: number;
  avgScore: number;
  maxScore: number;
  digestIncluded: number;
}

export interface NewsletterStats {
  bucket: 'newsletter';
  totals: BucketTotals;
  scoreHistogram: { score: number; count: number }[];  // 0..10
  topScoringSenders: NewsletterSenderStat[];
  digestIncludedWeek: number;
  digestIncludedMonth: number;
  topInteresting: (EmailRef & { score: number; reasons: string[] })[];
}

// --- Notification ------------------------------------------------------------

export interface NoisySenderStat {
  address: string;
  count: number;
  notified: number;
  highCount: number;
}

export interface NotificationStats {
  bucket: 'notification';
  totals: BucketTotals;
  severityCounts: Record<string, number>;
  urgencyCounts: Record<string, number>;
  severityUrgencyMatrix: { severity: string; urgency: string; count: number }[];
  noisiestSenders: NoisySenderStat[];
  recentHigh: (EmailRef & { severity: string | null; urgency: string | null; summary: string })[];
}

// --- Human -------------------------------------------------------------------

export interface HumanSenderSnapshot {
  id: number;
  identifier: string;
  rating: number | null;
  ratingReasoning: string;
  ratingManual: boolean;
  emailCount: number;
  lastSeenAt: string;
}

export interface HumanStats {
  bucket: 'human';
  totals: BucketTotals;
  ratingHistogram: { bucket: string; count: number }[];  // bins 0-9, 10-19, ...
  atThreshold: HumanSenderSnapshot[];   // rating 30..49
  quietHumans: HumanSenderSnapshot[];   // rating < 40
  unratedSenders: number;
  ratedSenders: number;
}

// --- Transactional -----------------------------------------------------------

export interface VendorStat {
  vendor: string;
  count: number;
  lastSeenAt: string;
}

export interface TransactionalStats {
  bucket: 'transactional';
  totals: BucketTotals;
  topVendors: VendorStat[];
  documentTypeCounts: { type: string; count: number }[];
  recent: (EmailRef & {
    vendor: string | null;
    documentType: string | null;
    amount: string | null;
  })[];
}

// --- Security ----------------------------------------------------------------

export interface SecurityStats {
  bucket: 'security';
  totals: BucketTotals;
  actionTypeCounts: { type: string; count: number }[];
  otpCount: number;
  otpCountMonth: number;
  recent: (EmailRef & {
    actionType: string | null;
    isOtp: boolean | null;
    summary: string;
  })[];
}

// --- Calendar ----------------------------------------------------------------

export interface CalendarEventRef {
  id: string;
  subject: string;
  fromAddress: string;
  processedAt: string;
  eventTitle: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventLocation: string | null;
  eventAttendees: string[];
}

export interface CalendarStats {
  bucket: 'calendar';
  totals: BucketTotals;
  upcoming: CalendarEventRef[];
  recentPast: CalendarEventRef[];
  undatedCount: number;
}

export type BucketStats =
  | NewsletterStats
  | NotificationStats
  | HumanStats
  | TransactionalStats
  | SecurityStats
  | CalendarStats;

function safeParseJSON<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function getBucketTotals(
  db: D1Database,
  userId: number,
  bucket: Bucket,
  windows: { weekStart: string; monthStart: string },
): Promise<BucketTotals> {
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) as all_time,
        SUM(CASE WHEN processed_at >= ? THEN 1 ELSE 0 END) as month,
        SUM(CASE WHEN processed_at >= ? THEN 1 ELSE 0 END) as week
       FROM emails WHERE user_id = ? AND bucket = ?`,
    )
    .bind(windows.monthStart, windows.weekStart, userId, bucket)
    .first<{ all_time: number; month: number; week: number }>();
  return {
    allTime: row?.all_time ?? 0,
    month: row?.month ?? 0,
    week: row?.week ?? 0,
  };
}

function getWindows() {
  const now = Date.now();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  return { weekStart, monthStart };
}

// --- Newsletter stats --------------------------------------------------------

async function getNewsletterStats(db: D1Database, userId: number): Promise<NewsletterStats> {
  const windows = getWindows();
  const totals = await getBucketTotals(db, userId, 'newsletter', windows);

  const { results: histRows } = await db
    .prepare(
      `SELECT interesting_score as score, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'newsletter' AND interesting_score IS NOT NULL
       GROUP BY interesting_score`,
    )
    .bind(userId)
    .all<{ score: number; cnt: number }>();
  const scoreHistogram = Array.from({ length: 11 }, (_, i) => ({
    score: i,
    count: histRows.find((r) => r.score === i)?.cnt ?? 0,
  }));

  const { results: senderRows } = await db
    .prepare(
      `SELECT from_address,
              COUNT(*) as cnt,
              AVG(interesting_score) as avg_score,
              MAX(interesting_score) as max_score,
              SUM(CASE WHEN included_in_digest IS NOT NULL THEN 1 ELSE 0 END) as digested
       FROM emails
       WHERE user_id = ? AND bucket = 'newsletter' AND interesting_score IS NOT NULL
       GROUP BY from_address
       ORDER BY avg_score DESC, cnt DESC
       LIMIT 15`,
    )
    .bind(userId)
    .all<{
      from_address: string;
      cnt: number;
      avg_score: number;
      max_score: number;
      digested: number;
    }>();
  const topScoringSenders: NewsletterSenderStat[] = senderRows.map((r) => ({
    address: r.from_address,
    count: r.cnt,
    avgScore: Math.round((r.avg_score ?? 0) * 10) / 10,
    maxScore: r.max_score ?? 0,
    digestIncluded: r.digested ?? 0,
  }));

  const digestWeekRow = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM emails
       WHERE user_id = ? AND bucket = 'newsletter'
         AND included_in_digest IS NOT NULL AND processed_at >= ?`,
    )
    .bind(userId, windows.weekStart)
    .first<{ cnt: number }>();
  const digestMonthRow = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM emails
       WHERE user_id = ? AND bucket = 'newsletter'
         AND included_in_digest IS NOT NULL AND processed_at >= ?`,
    )
    .bind(userId, windows.monthStart)
    .first<{ cnt: number }>();

  const { results: topRows } = await db
    .prepare(
      `SELECT id, subject, from_address, processed_at, interesting_score, interesting_reasons
       FROM emails
       WHERE user_id = ? AND bucket = 'newsletter' AND interesting_score >= 6
       ORDER BY interesting_score DESC, processed_at DESC
       LIMIT 10`,
    )
    .bind(userId)
    .all<{
      id: string;
      subject: string;
      from_address: string;
      processed_at: string;
      interesting_score: number;
      interesting_reasons: string;
    }>();
  const topInteresting = topRows.map((r) => ({
    id: r.id,
    subject: r.subject,
    fromAddress: r.from_address,
    processedAt: r.processed_at,
    score: r.interesting_score,
    reasons: safeParseJSON<string[]>(r.interesting_reasons, []),
  }));

  return {
    bucket: 'newsletter',
    totals,
    scoreHistogram,
    topScoringSenders,
    digestIncludedWeek: digestWeekRow?.cnt ?? 0,
    digestIncludedMonth: digestMonthRow?.cnt ?? 0,
    topInteresting,
  };
}

// --- Notification stats ------------------------------------------------------

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
const URGENCY_ORDER = ['low', 'medium', 'high'];

async function getNotificationStats(db: D1Database, userId: number): Promise<NotificationStats> {
  const windows = getWindows();
  const totals = await getBucketTotals(db, userId, 'notification', windows);

  const { results: sevRows } = await db
    .prepare(
      `SELECT severity, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'notification' AND severity IS NOT NULL
       GROUP BY severity`,
    )
    .bind(userId)
    .all<{ severity: string; cnt: number }>();
  const severityCounts: Record<string, number> = {};
  for (const s of SEVERITY_ORDER) severityCounts[s] = 0;
  for (const r of sevRows) severityCounts[r.severity] = r.cnt;

  const { results: urgRows } = await db
    .prepare(
      `SELECT urgency, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'notification' AND urgency IS NOT NULL
       GROUP BY urgency`,
    )
    .bind(userId)
    .all<{ urgency: string; cnt: number }>();
  const urgencyCounts: Record<string, number> = {};
  for (const u of URGENCY_ORDER) urgencyCounts[u] = 0;
  for (const r of urgRows) urgencyCounts[r.urgency] = r.cnt;

  const { results: matrixRows } = await db
    .prepare(
      `SELECT severity, urgency, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'notification'
         AND severity IS NOT NULL AND urgency IS NOT NULL
       GROUP BY severity, urgency`,
    )
    .bind(userId)
    .all<{ severity: string; urgency: string; cnt: number }>();
  const severityUrgencyMatrix: { severity: string; urgency: string; count: number }[] = [];
  for (const severity of SEVERITY_ORDER) {
    for (const urgency of URGENCY_ORDER) {
      severityUrgencyMatrix.push({
        severity,
        urgency,
        count:
          matrixRows.find((r) => r.severity === severity && r.urgency === urgency)?.cnt ?? 0,
      });
    }
  }

  const { results: noisyRows } = await db
    .prepare(
      `SELECT from_address,
              COUNT(*) as cnt,
              SUM(notification_sent) as notified,
              SUM(CASE WHEN severity IN ('high','critical') THEN 1 ELSE 0 END) as high_cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'notification' AND processed_at >= ?
       GROUP BY from_address
       ORDER BY cnt DESC
       LIMIT 15`,
    )
    .bind(userId, windows.monthStart)
    .all<{ from_address: string; cnt: number; notified: number; high_cnt: number }>();
  const noisiestSenders: NoisySenderStat[] = noisyRows.map((r) => ({
    address: r.from_address,
    count: r.cnt,
    notified: r.notified ?? 0,
    highCount: r.high_cnt ?? 0,
  }));

  const { results: recentRows } = await db
    .prepare(
      `SELECT id, subject, from_address, processed_at, severity, urgency, summary
       FROM emails
       WHERE user_id = ? AND bucket = 'notification'
         AND (severity IN ('high','critical') OR urgency = 'high')
       ORDER BY processed_at DESC
       LIMIT 15`,
    )
    .bind(userId)
    .all<{
      id: string;
      subject: string;
      from_address: string;
      processed_at: string;
      severity: string | null;
      urgency: string | null;
      summary: string;
    }>();
  const recentHigh = recentRows.map((r) => ({
    id: r.id,
    subject: r.subject,
    fromAddress: r.from_address,
    processedAt: r.processed_at,
    severity: r.severity,
    urgency: r.urgency,
    summary: r.summary,
  }));

  return {
    bucket: 'notification',
    totals,
    severityCounts,
    urgencyCounts,
    severityUrgencyMatrix,
    noisiestSenders,
    recentHigh,
  };
}

// --- Human stats -------------------------------------------------------------

async function getHumanStats(db: D1Database, userId: number): Promise<HumanStats> {
  const windows = getWindows();
  const totals = await getBucketTotals(db, userId, 'human', windows);

  // Rating distribution — look at sender profiles where we've seen human emails
  // (i.e. bucket_counts has 'human'), grouped by 10-point rating bins.
  const { results: ratingRows } = await db
    .prepare(
      `SELECT rating FROM sender_profiles
       WHERE user_id = ? AND profile_type = 'sender'
         AND json_extract(bucket_counts, '$.human') > 0
         AND rating IS NOT NULL`,
    )
    .bind(userId)
    .all<{ rating: number }>();
  const histogram: Record<string, number> = {};
  for (let i = 0; i < 10; i++) {
    const lo = i * 10;
    const hi = lo + 9;
    histogram[`${lo}-${hi}`] = 0;
  }
  histogram['100'] = 0;
  for (const r of ratingRows) {
    if (r.rating === 100) histogram['100'] += 1;
    else {
      const lo = Math.floor(r.rating / 10) * 10;
      histogram[`${lo}-${lo + 9}`] = (histogram[`${lo}-${lo + 9}`] ?? 0) + 1;
    }
  }
  const ratingHistogram = Object.entries(histogram).map(([bucket, count]) => ({
    bucket,
    count,
  }));

  const { results: thresholdRows } = await db
    .prepare(
      `SELECT id, identifier, rating, rating_reasoning, rating_manual,
              email_count, last_seen_at
       FROM sender_profiles
       WHERE user_id = ? AND profile_type = 'sender'
         AND json_extract(bucket_counts, '$.human') > 0
         AND rating IS NOT NULL AND rating >= 30 AND rating < 50
       ORDER BY last_seen_at DESC
       LIMIT 20`,
    )
    .bind(userId)
    .all<{
      id: number;
      identifier: string;
      rating: number;
      rating_reasoning: string;
      rating_manual: number;
      email_count: number;
      last_seen_at: string;
    }>();
  const atThreshold: HumanSenderSnapshot[] = thresholdRows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    rating: r.rating,
    ratingReasoning: r.rating_reasoning ?? '',
    ratingManual: (r.rating_manual ?? 0) === 1,
    emailCount: r.email_count,
    lastSeenAt: r.last_seen_at,
  }));

  const { results: quietRows } = await db
    .prepare(
      `SELECT id, identifier, rating, rating_reasoning, rating_manual,
              email_count, last_seen_at
       FROM sender_profiles
       WHERE user_id = ? AND profile_type = 'sender'
         AND json_extract(bucket_counts, '$.human') > 0
         AND rating IS NOT NULL AND rating < 40
       ORDER BY last_seen_at DESC
       LIMIT 20`,
    )
    .bind(userId)
    .all<{
      id: number;
      identifier: string;
      rating: number;
      rating_reasoning: string;
      rating_manual: number;
      email_count: number;
      last_seen_at: string;
    }>();
  const quietHumans: HumanSenderSnapshot[] = quietRows.map((r) => ({
    id: r.id,
    identifier: r.identifier,
    rating: r.rating,
    ratingReasoning: r.rating_reasoning ?? '',
    ratingManual: (r.rating_manual ?? 0) === 1,
    emailCount: r.email_count,
    lastSeenAt: r.last_seen_at,
  }));

  const countsRow = await db
    .prepare(
      `SELECT
        SUM(CASE WHEN rating IS NULL THEN 1 ELSE 0 END) as unrated,
        SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) as rated
       FROM sender_profiles
       WHERE user_id = ? AND profile_type = 'sender'
         AND json_extract(bucket_counts, '$.human') > 0`,
    )
    .bind(userId)
    .first<{ unrated: number; rated: number }>();

  return {
    bucket: 'human',
    totals,
    ratingHistogram,
    atThreshold,
    quietHumans,
    unratedSenders: countsRow?.unrated ?? 0,
    ratedSenders: countsRow?.rated ?? 0,
  };
}

// --- Transactional stats -----------------------------------------------------

async function getTransactionalStats(db: D1Database, userId: number): Promise<TransactionalStats> {
  const windows = getWindows();
  const totals = await getBucketTotals(db, userId, 'transactional', windows);

  const { results: vendorRows } = await db
    .prepare(
      `SELECT vendor, COUNT(*) as cnt, MAX(processed_at) as last_seen
       FROM emails
       WHERE user_id = ? AND bucket = 'transactional' AND vendor IS NOT NULL AND vendor != ''
       GROUP BY vendor
       ORDER BY cnt DESC
       LIMIT 20`,
    )
    .bind(userId)
    .all<{ vendor: string; cnt: number; last_seen: string }>();
  const topVendors: VendorStat[] = vendorRows.map((r) => ({
    vendor: r.vendor,
    count: r.cnt,
    lastSeenAt: r.last_seen,
  }));

  const { results: docRows } = await db
    .prepare(
      `SELECT document_type as type, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'transactional' AND document_type IS NOT NULL AND document_type != ''
       GROUP BY document_type
       ORDER BY cnt DESC`,
    )
    .bind(userId)
    .all<{ type: string; cnt: number }>();
  const documentTypeCounts = docRows.map((r) => ({
    type: r.type,
    count: r.cnt,
  }));

  const { results: recentRows } = await db
    .prepare(
      `SELECT id, subject, from_address, processed_at, vendor, document_type, amount
       FROM emails
       WHERE user_id = ? AND bucket = 'transactional'
       ORDER BY processed_at DESC
       LIMIT 20`,
    )
    .bind(userId)
    .all<{
      id: string;
      subject: string;
      from_address: string;
      processed_at: string;
      vendor: string | null;
      document_type: string | null;
      amount: string | null;
    }>();
  const recent = recentRows.map((r) => ({
    id: r.id,
    subject: r.subject,
    fromAddress: r.from_address,
    processedAt: r.processed_at,
    vendor: r.vendor,
    documentType: r.document_type,
    amount: r.amount,
  }));

  return {
    bucket: 'transactional',
    totals,
    topVendors,
    documentTypeCounts,
    recent,
  };
}

// --- Security stats ----------------------------------------------------------

async function getSecurityStats(db: D1Database, userId: number): Promise<SecurityStats> {
  const windows = getWindows();
  const totals = await getBucketTotals(db, userId, 'security', windows);

  const { results: typeRows } = await db
    .prepare(
      `SELECT action_type as type, COUNT(*) as cnt
       FROM emails
       WHERE user_id = ? AND bucket = 'security' AND action_type IS NOT NULL AND action_type != ''
       GROUP BY action_type
       ORDER BY cnt DESC`,
    )
    .bind(userId)
    .all<{ type: string; cnt: number }>();
  const actionTypeCounts = typeRows.map((r) => ({
    type: r.type,
    count: r.cnt,
  }));

  const otpAll = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM emails
       WHERE user_id = ? AND bucket = 'security' AND is_otp = 1`,
    )
    .bind(userId)
    .first<{ cnt: number }>();
  const otpMonth = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM emails
       WHERE user_id = ? AND bucket = 'security' AND is_otp = 1 AND processed_at >= ?`,
    )
    .bind(userId, windows.monthStart)
    .first<{ cnt: number }>();

  const { results: recentRows } = await db
    .prepare(
      `SELECT id, subject, from_address, processed_at, action_type, is_otp, summary
       FROM emails
       WHERE user_id = ? AND bucket = 'security'
       ORDER BY processed_at DESC
       LIMIT 25`,
    )
    .bind(userId)
    .all<{
      id: string;
      subject: string;
      from_address: string;
      processed_at: string;
      action_type: string | null;
      is_otp: number | null;
      summary: string;
    }>();
  const recent = recentRows.map((r) => ({
    id: r.id,
    subject: r.subject,
    fromAddress: r.from_address,
    processedAt: r.processed_at,
    actionType: r.action_type,
    isOtp: r.is_otp === null ? null : r.is_otp === 1,
    summary: r.summary,
  }));

  return {
    bucket: 'security',
    totals,
    actionTypeCounts,
    otpCount: otpAll?.cnt ?? 0,
    otpCountMonth: otpMonth?.cnt ?? 0,
    recent,
  };
}

// --- Calendar stats ----------------------------------------------------------

async function getCalendarStats(db: D1Database, userId: number): Promise<CalendarStats> {
  const windows = getWindows();
  const totals = await getBucketTotals(db, userId, 'calendar', windows);
  const nowIso = new Date().toISOString();

  const eventCols =
    'id, subject, from_address, processed_at, event_title, event_starts_at, event_ends_at, event_location, event_attendees';

  const { results: upcomingRows } = await db
    .prepare(
      `SELECT ${eventCols}
       FROM emails
       WHERE user_id = ? AND bucket = 'calendar' AND event_starts_at >= ?
       ORDER BY event_starts_at ASC
       LIMIT 20`,
    )
    .bind(userId, nowIso)
    .all<EventRow>();
  const { results: pastRows } = await db
    .prepare(
      `SELECT ${eventCols}
       FROM emails
       WHERE user_id = ? AND bucket = 'calendar'
         AND event_starts_at IS NOT NULL AND event_starts_at < ?
       ORDER BY event_starts_at DESC
       LIMIT 10`,
    )
    .bind(userId, nowIso)
    .all<EventRow>();
  const undatedRow = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM emails
       WHERE user_id = ? AND bucket = 'calendar' AND event_starts_at IS NULL`,
    )
    .bind(userId)
    .first<{ cnt: number }>();

  return {
    bucket: 'calendar',
    totals,
    upcoming: upcomingRows.map(mapEventRow),
    recentPast: pastRows.map(mapEventRow),
    undatedCount: undatedRow?.cnt ?? 0,
  };
}

interface EventRow {
  id: string;
  subject: string;
  from_address: string;
  processed_at: string;
  event_title: string | null;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_location: string | null;
  event_attendees: string;
}

function mapEventRow(r: EventRow): CalendarEventRef {
  return {
    id: r.id,
    subject: r.subject,
    fromAddress: r.from_address,
    processedAt: r.processed_at,
    eventTitle: r.event_title,
    eventStartsAt: r.event_starts_at,
    eventEndsAt: r.event_ends_at,
    eventLocation: r.event_location,
    eventAttendees: safeParseJSON<string[]>(r.event_attendees, []),
  };
}

export async function getBucketStats(
  db: D1Database,
  userId: number,
  bucket: Bucket,
): Promise<BucketStats> {
  switch (bucket) {
    case 'newsletter':
      return getNewsletterStats(db, userId);
    case 'notification':
      return getNotificationStats(db, userId);
    case 'human':
      return getHumanStats(db, userId);
    case 'transactional':
      return getTransactionalStats(db, userId);
    case 'security':
      return getSecurityStats(db, userId);
    case 'calendar':
      return getCalendarStats(db, userId);
  }
}
