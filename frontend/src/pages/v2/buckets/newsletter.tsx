import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { NewsletterBucketStats } from "@/lib/types";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BUCKET_CHART_COLORS } from "@/components/v2/badges";
import { BucketPageHeader } from "./shared";

function ScoreHistogram({
  data,
}: {
  data: { score: number; count: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d) => {
        const h = (d.count / max) * 100;
        const interesting = d.score >= 6;
        return (
          <div
            key={d.score}
            className="flex flex-1 flex-col items-center gap-1"
            title={`Score ${d.score}: ${d.count} emails`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className={cn(
                  "w-full rounded-t",
                  interesting ? "" : "bg-muted-foreground/30",
                )}
                style={{
                  height: `${h}%`,
                  backgroundColor: interesting
                    ? BUCKET_CHART_COLORS.newsletter
                    : undefined,
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {d.score}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function NewsletterBucketPage() {
  const [stats, setStats] = useState<NewsletterBucketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBucketStats("newsletter")
      .then((s) => {
        if (cancelled) return;
        if (s.bucket !== "newsletter") throw new Error("bucket mismatch");
        setStats(s);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading && !stats) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Failed: {error}</p>;
  if (!stats) return null;

  const total = stats.score_histogram.reduce((a, b) => a + b.count, 0);
  const interestingCount = stats.score_histogram
    .filter((d) => d.score >= 6)
    .reduce((a, b) => a + b.count, 0);
  const interestingRate =
    total > 0 ? Math.round((interestingCount / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <BucketPageHeader bucket="newsletter" totals={stats.totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardDescription>Score distribution (all time)</CardDescription>
            <CardTitle className="flex items-baseline gap-2">
              <span className="text-xl">
                {interestingRate}%{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  scored ≥ 6
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScoreHistogram data={stats.score_histogram} />
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>not interesting</span>
              <span>threshold (6)</span>
              <span>highly interesting</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Included in digest</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {stats.digest_included_week.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {stats.totals.week} this week
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">
              {stats.digest_included_month.toLocaleString()} in the last 30 days
              ({stats.totals.month} total newsletters).
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Highest scoring senders</CardDescription>
          <CardTitle className="text-xl">Who's worth reading</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.top_scoring_senders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scored newsletters yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead className="text-right">Digested</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.top_scoring_senders.map((s) => (
                  <TableRow key={s.address}>
                    <TableCell className="max-w-xs truncate" title={s.address}>
                      <Link
                        to={`/senders?identifier=${encodeURIComponent(s.address)}&type=sender`}
                        className="hover:underline"
                      >
                        {s.address}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={cn(
                          "font-medium",
                          s.avg_score >= 6
                            ? "text-blue-700 dark:text-blue-300"
                            : "text-muted-foreground",
                        )}
                      >
                        {s.avg_score.toFixed(1)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {s.max_score}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {s.digest_included}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {s.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Recent high-score</CardDescription>
          <CardTitle className="text-xl">Top picks</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.top_interesting.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing scored ≥ 6 yet.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.top_interesting.map((e) => (
                <li key={e.id} className="py-2 first:pt-0 last:pb-0">
                  <Link
                    to={`/emails?id=${e.id}`}
                    className="block hover:underline"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-500/20 dark:text-blue-200">
                        {e.score}/10
                      </span>
                      <span className="truncate text-sm font-medium">
                        {e.subject}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {e.from_address} · {timeAgo(e.processed_at)}
                    </div>
                    {e.reasons.length > 0 && (
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {e.reasons[0]}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

