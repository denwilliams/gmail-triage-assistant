import { useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  Bucket,
  Email,
  TriageVia,
  V2PipelineStats,
} from "@/lib/types";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BUCKET_CHART_COLORS,
  BUCKET_OPTIONS,
  BucketBadge,
  StageBadge,
  TRIAGE_VIA_LABELS,
} from "@/components/v2/badges";

const TRIAGE_VIAS: TriageVia[] = ["ai", "thread_reply", "consistent_sender"];

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function BucketDistribution({
  counts,
  title,
  description,
}: {
  counts: Record<Bucket, number>;
  title: string;
  description: string;
}) {
  const total = sumCounts(counts);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>{description}</CardDescription>
        <CardTitle className="flex items-baseline gap-2 text-xl">
          <span>{title}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {total} total
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">No emails yet.</p>
        ) : (
          BUCKET_OPTIONS.map((bucket) => {
            const count = counts[bucket] ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <Link
                key={bucket}
                to={`/v2/buckets/${bucket}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60"
              >
                <div className="w-24 shrink-0">
                  <BucketBadge bucket={bucket} />
                </div>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: BUCKET_CHART_COLORS[bucket],
                    }}
                  />
                </div>
                <div className="flex w-20 justify-end gap-2 text-right text-xs tabular-nums">
                  <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                  <span className="font-medium">{count}</span>
                </div>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function TriagePathCard({
  triageVia,
  weekTotal,
}: {
  triageVia: Record<TriageVia, number>;
  weekTotal: number;
}) {
  const total = sumCounts(triageVia);
  const aiCount = triageVia.ai ?? 0;
  const fastPath = total - aiCount;
  const fastPathPct = total > 0 ? (fastPath / total) * 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>Triage path — last 7 days</CardDescription>
        <CardTitle className="flex items-baseline gap-2 text-xl">
          <span>{fastPathPct.toFixed(0)}%</span>
          <span className="text-sm font-normal text-muted-foreground">
            skipped AI
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No triage activity yet this week.
          </p>
        ) : (
          TRIAGE_VIAS.map((via) => {
            const count = triageVia[via] ?? 0;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={via} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted-foreground">
                  {TRIAGE_VIA_LABELS[via]}
                </span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      via === "ai" ? "bg-primary/70" : "bg-emerald-500",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex w-20 justify-end gap-2 text-right text-xs tabular-nums">
                  <span className="text-muted-foreground">{pct.toFixed(0)}%</span>
                  <span className="font-medium">{count}</span>
                </div>
              </div>
            );
          })
        )}
        {weekTotal > total && (
          <p className="pt-1 text-xs text-muted-foreground">
            {weekTotal - total} additional emails triaged without recorded path.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecentFailuresCard({
  failures,
}: {
  failures: V2PipelineStats["recent_failures"];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>Recent failures</CardDescription>
        <CardTitle className="text-xl">
          {failures.length === 0 ? "Clean" : `${failures.length} failed`}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pipeline failures. Nice.
          </p>
        ) : (
          <ul className="divide-y">
            {failures.map((f) => (
              <li key={f.id} className="py-2 first:pt-0 last:pb-0">
                <Link
                  to={`/v2/emails?id=${f.id}`}
                  className="block text-sm hover:underline"
                >
                  <div className="flex items-center gap-2">
                    <StageBadge stage="failed" />
                    {f.bucket && <BucketBadge bucket={f.bucket} />}
                    <span className="truncate font-medium">{f.subject}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {f.from_address} · {timeAgo(f.processed_at)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentEmailsCard({ emails }: { emails: Email[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-3">
        <div>
          <CardDescription>Latest activity</CardDescription>
          <CardTitle className="text-xl">Recent emails</CardTitle>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/v2/emails">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No v2-processed emails yet. Switch pipeline to v2 in settings.
          </p>
        ) : (
          <ul className="divide-y">
            {emails.map((e) => (
              <li key={e.id} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  {e.bucket && <BucketBadge bucket={e.bucket} />}
                  <span className="truncate text-sm font-medium">
                    {e.subject}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <span className="truncate">{e.from_address}</span>
                  <span className="mx-1">·</span>
                  <span>{timeAgo(e.processed_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function V2DashboardPage() {
  const [stats, setStats] = useState<V2PipelineStats | null>(null);
  const [recent, setRecent] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.getV2PipelineStats(),
      api.getEmails(8, 0, { v2_only: true }),
    ])
      .then(([s, r]) => {
        if (cancelled) return;
        setStats(s);
        setRecent(r ?? []);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !stats) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (error) {
    return <p className="text-destructive">Failed to load v2 stats: {error}</p>;
  }

  if (!stats) return null;

  const topCards: { label: string; value: string; hint?: string }[] = [
    {
      label: "Processed today",
      value: stats.total_v2_today.toLocaleString(),
    },
    {
      label: "Last 7 days",
      value: stats.total_v2_this_week.toLocaleString(),
    },
    {
      label: "In digest (7d)",
      value: stats.digest_included_week.toLocaleString(),
    },
    {
      label: "Currently queued",
      value: (
        stats.stage_counts.queued + stats.stage_counts.bucketed
      ).toLocaleString(),
      hint:
        stats.stage_counts.queued + stats.stage_counts.bucketed > 0
          ? `${stats.stage_counts.queued} queued · ${stats.stage_counts.bucketed} bucketed`
          : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {topCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-2xl">{c.value}</CardTitle>
              {c.hint && (
                <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
              )}
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BucketDistribution
          counts={stats.bucket_counts_today}
          title="Today"
          description="Bucket distribution"
        />
        <BucketDistribution
          counts={stats.bucket_counts_week}
          title="Last 7 days"
          description="Bucket distribution"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TriagePathCard
          triageVia={stats.triage_via_week}
          weekTotal={stats.total_v2_this_week}
        />
        <RecentFailuresCard failures={stats.recent_failures} />
      </div>

      <RecentEmailsCard emails={recent} />
    </div>
  );
}
