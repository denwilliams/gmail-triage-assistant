import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { HumanBucketStats, HumanSenderSnapshot } from "@/lib/types";
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
import { BUCKET_CHART_COLORS } from "@/components/v2/badges";
import { BucketPageHeader } from "./shared";

function RatingHistogram({
  data,
}: {
  data: { bucket: string; count: number }[];
}) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex gap-1 h-32">
      {data.map((d) => {
        const h = d.count === 0 ? 0 : Math.max(2, (d.count / max) * 100);
        const loBound = parseInt(d.bucket.split("-")[0], 10);
        const aboveThreshold = loBound >= 40;
        return (
          <div
            key={d.bucket}
            className="flex flex-1 flex-col items-center gap-1"
            title={`Rating ${d.bucket}: ${d.count} senders`}
          >
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t"
                style={{
                  height: `${h}%`,
                  backgroundColor: aboveThreshold
                    ? BUCKET_CHART_COLORS.human
                    : "var(--color-muted-foreground)",
                  opacity: aboveThreshold ? 1 : 0.4,
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {d.bucket}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RateNowButton({
  profileId,
  onDone,
}: {
  profileId: number;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.rateSenderNow(profileId);
          onDone();
        } catch (err) {
          alert(
            "Rate failed: " + (err instanceof Error ? err.message : "Unknown"),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "..." : "Rate"}
    </Button>
  );
}

function SenderList({
  title,
  description,
  empty,
  items,
  onReload,
  accent,
}: {
  title: string;
  description: string;
  empty: string;
  items: HumanSenderSnapshot[];
  onReload: () => void;
  accent?: "warn" | "default";
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription>{description}</CardDescription>
        <CardTitle className="flex items-baseline gap-2 text-xl">
          <span>{title}</span>
          <span className="text-sm font-normal text-muted-foreground">
            {items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((p) => (
              <li key={p.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/senders?identifier=${encodeURIComponent(p.identifier)}&type=sender`}
                      className="truncate text-sm font-medium hover:underline"
                      title={p.identifier}
                    >
                      {p.identifier}
                    </Link>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                        accent === "warn"
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100"
                          : "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
                      )}
                    >
                      rating {p.rating}
                    </span>
                    {p.rating_manual && (
                      <span
                        className="text-[10px] font-medium uppercase text-muted-foreground"
                        title="Manual override"
                      >
                        manual
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {p.email_count} emails · last seen {timeAgo(p.last_seen_at)}
                  </div>
                  {p.rating_reasoning && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      {p.rating_reasoning}
                    </p>
                  )}
                </div>
                <RateNowButton profileId={p.id} onDone={onReload} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function HumanBucketPage() {
  const [stats, setStats] = useState<HumanBucketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getBucketStats("human")
      .then((s) => {
        if (s.bucket !== "human") throw new Error("bucket mismatch");
        setStats(s);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading && !stats) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Failed: {error}</p>;
  if (!stats) return null;

  const totalRated = stats.rated_senders + stats.unrated_senders;
  const unratedPct =
    totalRated > 0 ? Math.round((stats.unrated_senders / totalRated) * 100) : 0;

  return (
    <div className="space-y-6">
      <BucketPageHeader bucket="human" totals={stats.totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardDescription>
              Rating distribution across human senders
            </CardDescription>
            <CardTitle className="text-xl">
              {stats.rated_senders} rated · {stats.unrated_senders} unrated
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RatingHistogram data={stats.rating_histogram} />
            <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
              <span>low priority</span>
              <span>threshold (40)</span>
              <span>high priority</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Unrated</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {stats.unrated_senders}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {unratedPct}%
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              These senders will fall back to AI decisions without a rating
              — they'll get rated on their next email, or via a nightly sweep.
            </p>
          </CardContent>
        </Card>
      </div>

      <SenderList
        title="Quiet humans"
        description="Rated < 40 — archived by default"
        empty="No low-rated humans. Everyone's making the inbox."
        items={stats.quiet_humans}
        onReload={load}
      />

      <SenderList
        title="At threshold"
        description="Rated 30-49 — borderline, review for mis-grading"
        empty="No senders near the threshold."
        items={stats.at_threshold}
        onReload={load}
        accent="warn"
      />
    </div>
  );
}
