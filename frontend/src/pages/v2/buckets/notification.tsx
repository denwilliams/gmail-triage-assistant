import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { NotificationBucketStats } from "@/lib/types";
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
import { SeverityUrgencyChips } from "@/components/v2/badges";
import { BucketPageHeader } from "./shared";

const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
const URGENCY_ORDER = ["low", "medium", "high"];

function cellIntensity(count: number, max: number): string {
  if (count === 0) return "bg-muted/40 text-muted-foreground";
  const ratio = count / Math.max(1, max);
  if (ratio < 0.25) return "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100";
  if (ratio < 0.5) return "bg-orange-100 text-orange-900 dark:bg-orange-500/25 dark:text-orange-100";
  if (ratio < 0.75) return "bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-100";
  return "bg-red-200 text-red-950 font-semibold dark:bg-red-500/45 dark:text-red-50";
}

function SeverityUrgencyGrid({
  matrix,
}: {
  matrix: { severity: string; urgency: string; count: number }[];
}) {
  const max = Math.max(0, ...matrix.map((m) => m.count));
  const cell = (sev: string, urg: string) =>
    matrix.find((m) => m.severity === sev && m.urgency === urg)?.count ?? 0;

  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead>
          <tr>
            <th className="p-2"></th>
            {URGENCY_ORDER.map((u) => (
              <th key={u} className="min-w-20 px-3 py-1 text-xs font-medium uppercase text-muted-foreground">
                urg: {u}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SEVERITY_ORDER.map((sev) => (
            <tr key={sev}>
              <td className="pr-3 text-right text-xs font-medium uppercase text-muted-foreground">
                sev: {sev}
              </td>
              {URGENCY_ORDER.map((urg) => {
                const c = cell(sev, urg);
                return (
                  <td key={urg} className="p-1">
                    <div
                      className={cn(
                        "flex h-14 min-w-20 items-center justify-center rounded text-base tabular-nums",
                        cellIntensity(c, max),
                      )}
                    >
                      {c}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NotificationBucketPage() {
  const [stats, setStats] = useState<NotificationBucketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBucketStats("notification")
      .then((s) => {
        if (cancelled) return;
        if (s.bucket !== "notification") throw new Error("bucket mismatch");
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

  return (
    <div className="space-y-6">
      <BucketPageHeader bucket="notification" totals={stats.totals} />

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>
            Severity × Urgency (all time)
          </CardDescription>
          <CardTitle className="text-xl">Signal vs noise</CardTitle>
        </CardHeader>
        <CardContent>
          <SeverityUrgencyGrid matrix={stats.severity_urgency_matrix} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Last 30 days</CardDescription>
          <CardTitle className="text-xl">Noisiest sources</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.noisiest_senders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Notified you</TableHead>
                  <TableHead className="text-right">High/critical</TableHead>
                  <TableHead className="text-right">Signal ratio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.noisiest_senders.map((s) => {
                  const signalRatio =
                    s.count > 0 ? Math.round((s.high_count / s.count) * 100) : 0;
                  return (
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
                        {s.count}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {s.notified}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {s.high_count}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right text-sm tabular-nums",
                          signalRatio >= 30
                            ? "text-red-600 dark:text-red-400"
                            : signalRatio >= 10
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {signalRatio}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>What woke you up</CardDescription>
          <CardTitle className="text-xl">Recent high priority</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recent_high.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No recent high-severity / high-urgency notifications.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.recent_high.map((e) => (
                <li key={e.id} className="py-2 first:pt-0 last:pb-0">
                  <Link
                    to={`/v2/emails?id=${e.id}`}
                    className="block hover:underline"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityUrgencyChips
                        severity={e.severity}
                        urgency={e.urgency}
                      />
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
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
