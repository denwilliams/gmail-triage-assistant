import type { Context } from 'hono';
import type { Env } from '../types/env';
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
} from '../types/models';
import type { V2PipelineStats, V2FailureRow } from '../db/stats';
import {
  getDashboardSummary,
  getDashboardTimeseries,
  getV2PipelineStats,
} from '../db/stats';

type AppContext = Context<{ Bindings: Env; Variables: { userId: number; email: string } }>;

function senderStatToJSON(s: SenderStat) {
  return { address: s.address, count: s.count, archive_rate: s.archiveRate };
}

function domainStatToJSON(d: DomainStat) {
  return { domain: d.domain, count: d.count, archive_rate: d.archiveRate };
}

function summaryToJSON(s: DashboardSummary) {
  return {
    total_emails: s.totalEmails,
    emails_today: s.emailsToday,
    emails_this_week: s.emailsThisWeek,
    unique_senders: s.uniqueSenders,
    bypass_rate: s.bypassRate,
    notification_rate: s.notificationRate,
    top_senders: s.topSenders.map(senderStatToJSON),
    top_domains: s.topDomains.map(domainStatToJSON),
    top_slugs: s.topSlugs.map((sl: SlugStat) => ({ slug: sl.slug, count: sl.count })),
    label_distribution: s.labelDistribution.map((l: LabelStat) => ({ label: l.label, count: l.count })),
    top_keywords: s.topKeywords.map((k: KeywordStat) => ({ keyword: k.keyword, count: k.count })),
    new_slugs_this_week: s.newSlugsThisWeek,
    recurring_slugs_this_week: s.recurringSlugsThisWeek,
  };
}

function timeseriesToJSON(ts: DashboardTimeseries) {
  return {
    daily_volume: ts.dailyVolume.map((d: DayCount) => ({ date: d.date, count: d.count })),
    daily_bypass_rate: ts.dailyBypassRate.map((d: DayRate) => ({
      date: d.date,
      total: d.total,
      count: d.count,
      rate: d.rate,
    })),
    daily_notifications: ts.dailyNotifications.map((d: DayCount) => ({ date: d.date, count: d.count })),
    label_trends: ts.labelTrends.map((d: DayLabelCount) => ({
      date: d.date,
      label: d.label,
      count: d.count,
    })),
    hourly_heatmap: ts.hourlyHeatmap.map((h: HourCount) => ({
      day_of_week: h.dayOfWeek,
      hour: h.hour,
      count: h.count,
    })),
  };
}

export async function handleGetStatsSummary(c: AppContext) {
  const userId = c.get('userId');

  try {
    const summary = await getDashboardSummary(c.env.DB, userId);
    return c.json(summaryToJSON(summary));
  } catch (e) {
    console.error('Failed to load stats summary:', e);
    return c.json({ error: 'Failed to load stats summary' }, 500);
  }
}

function failureToJSON(f: V2FailureRow) {
  return {
    id: f.id,
    from_address: f.fromAddress,
    subject: f.subject,
    bucket: f.bucket,
    pipeline_stage: f.pipelineStage,
    processed_at: f.processedAt,
  };
}

function v2StatsToJSON(s: V2PipelineStats) {
  return {
    total_v2: s.totalV2,
    total_v2_today: s.totalV2Today,
    total_v2_this_week: s.totalV2ThisWeek,
    bucket_counts_today: s.bucketCountsToday,
    bucket_counts_week: s.bucketCountsWeek,
    triage_via_week: s.triageViaWeek,
    stage_counts: s.stageCounts,
    digest_included_week: s.digestIncludedWeek,
    recent_failures: s.recentFailures.map(failureToJSON),
  };
}

export async function handleGetV2PipelineStats(c: AppContext) {
  const userId = c.get('userId');

  try {
    const stats = await getV2PipelineStats(c.env.DB, userId);
    return c.json(v2StatsToJSON(stats));
  } catch (e) {
    console.error('Failed to load v2 pipeline stats:', e);
    return c.json({ error: 'Failed to load v2 pipeline stats' }, 500);
  }
}

export async function handleGetStatsTimeseries(c: AppContext) {
  const userId = c.get('userId');
  let days = 30;
  const dParam = c.req.query('days');
  if (dParam) {
    const parsed = parseInt(dParam, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 365) days = parsed;
  }

  try {
    const timeseries = await getDashboardTimeseries(c.env.DB, userId, days);
    return c.json(timeseriesToJSON(timeseries));
  } catch (e) {
    console.error('Failed to load stats timeseries:', e);
    return c.json({ error: 'Failed to load stats timeseries' }, 500);
  }
}
