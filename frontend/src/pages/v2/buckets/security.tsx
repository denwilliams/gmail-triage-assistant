import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { SecurityBucketStats } from "@/lib/types";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BucketPageHeader } from "./shared";

const ACTION_TYPE_LABELS: Record<string, string> = {
  mfa: "MFA code",
  reset: "Password reset",
  login_alert: "Login alert",
  account_recovery: "Account recovery",
  other: "Other",
};

const ACTION_TYPE_STYLES: Record<string, string> = {
  mfa: "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-200",
  reset: "bg-orange-100 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200",
  login_alert: "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100",
  account_recovery: "bg-violet-100 text-violet-800 dark:bg-violet-500/25 dark:text-violet-200",
  other: "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
};

function ActionTypeChip({ type }: { type: string }) {
  const label = ACTION_TYPE_LABELS[type] ?? type;
  const style = ACTION_TYPE_STYLES[type] ?? ACTION_TYPE_STYLES.other;
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", style)}>
      {label}
    </span>
  );
}

export default function SecurityBucketPage() {
  const [stats, setStats] = useState<SecurityBucketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBucketStats("security")
      .then((s) => {
        if (cancelled) return;
        if (s.bucket !== "security") throw new Error("bucket mismatch");
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

  const actionTotal = stats.action_type_counts.reduce((a, b) => a + b.count, 0);

  return (
    <div className="space-y-6">
      <BucketPageHeader bucket="security" totals={stats.totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardDescription>Action type mix (all time)</CardDescription>
            <CardTitle className="text-xl">What we see</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.totals.week === 0 ? (
              <p className="text-sm text-muted-foreground">
                No security emails yet.
              </p>
            ) : actionTotal === 0 ? (
              <p className="text-sm text-muted-foreground">
                {stats.totals.all_time.toLocaleString()} email{stats.totals.all_time !== 1 ? "s" : ""} received, but no action types classified yet.
              </p>
            ) : (
              <div className="space-y-2">
                {stats.action_type_counts.map((t) => {
                  const pct = Math.round((t.count / actionTotal) * 100);
                  return (
                    <div key={t.type} className="flex items-center gap-3 text-sm">
                      <div className="w-32">
                        <ActionTypeChip type={t.type} />
                      </div>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            ACTION_TYPE_STYLES[t.type]?.split(" ")[0] ?? "bg-slate-400",
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-12 text-right tabular-nums text-xs text-muted-foreground">
                        {pct}%
                      </span>
                      <span className="w-10 text-right tabular-nums">
                        {t.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>OTP lane</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {stats.otp_count_month.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                last 30d
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {stats.otp_count.toLocaleString()} OTPs all time. Auto-deleted
              after 1 day.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Security timeline</CardDescription>
          <CardTitle className="text-xl">Recent events</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No security events yet.
            </p>
          ) : (
            <ol className="relative border-l border-border pl-5">
              {stats.recent.map((e) => (
                <li key={e.id} className="mb-4 ml-2 last:mb-0">
                  <span className="absolute -left-1.5 flex h-3 w-3 items-center justify-center rounded-full border border-background bg-red-500" />
                  <Link
                    to={`/emails?id=${e.id}`}
                    className="block hover:underline"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {e.action_type && <ActionTypeChip type={e.action_type} />}
                      {e.is_otp && (
                        <span className="rounded bg-red-200 px-1.5 py-0.5 text-[11px] font-semibold text-red-950 dark:bg-red-500/45 dark:text-red-50">
                          OTP
                        </span>
                      )}
                      <span className="truncate text-sm font-medium">
                        {e.subject}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {e.from_address} · {timeAgo(e.processed_at)}
                    </div>
                    {e.summary && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {e.summary}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
