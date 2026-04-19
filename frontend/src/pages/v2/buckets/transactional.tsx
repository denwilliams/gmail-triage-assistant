import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { TransactionalBucketStats } from "@/lib/types";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";
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

const DOC_TYPE_COLORS: Record<string, string> = {
  receipt: "#8b5cf6",
  invoice: "#6366f1",
  shipping: "#06b6d4",
  order: "#10b981",
  booking: "#f59e0b",
  refund: "#ef4444",
  other: "#64748b",
};

export default function TransactionalBucketPage() {
  const [stats, setStats] = useState<TransactionalBucketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBucketStats("transactional")
      .then((s) => {
        if (cancelled) return;
        if (s.bucket !== "transactional") throw new Error("bucket mismatch");
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

  const docTotal = stats.document_type_counts.reduce((a, b) => a + b.count, 0);
  const topVendorMax = Math.max(1, ...stats.top_vendors.map((v) => v.count));

  return (
    <div className="space-y-6">
      <BucketPageHeader bucket="transactional" totals={stats.totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Vendor leaderboard</CardDescription>
            <CardTitle className="text-xl">Who takes your money</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.top_vendors.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No vendors extracted yet. (Emails processed before this feature
                won't have vendor data.)
              </p>
            ) : (
              <ul className="space-y-2">
                {stats.top_vendors.map((v) => {
                  const pct = Math.round((v.count / topVendorMax) * 100);
                  return (
                    <li key={v.vendor} className="flex items-center gap-3 text-sm">
                      <code className="min-w-0 flex-1 truncate text-xs">
                        {v.vendor}
                      </code>
                      <div className="relative h-2 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: BUCKET_CHART_COLORS.transactional,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right tabular-nums text-xs">
                        {v.count}
                      </span>
                      <span className="w-20 text-right text-xs text-muted-foreground">
                        {timeAgo(v.last_seen_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Document types (all time)</CardDescription>
            <CardTitle className="text-xl">What kind of paperwork</CardTitle>
          </CardHeader>
          <CardContent>
            {docTotal === 0 ? (
              <p className="text-sm text-muted-foreground">
                No document types extracted yet.
              </p>
            ) : (
              <div className="space-y-2">
                {stats.document_type_counts.map((d) => {
                  const pct = Math.round((d.count / docTotal) * 100);
                  return (
                    <div key={d.type} className="flex items-center gap-3 text-sm">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{
                          backgroundColor:
                            DOC_TYPE_COLORS[d.type] ?? DOC_TYPE_COLORS.other,
                        }}
                      />
                      <span className="flex-1 capitalize">{d.type}</span>
                      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                        {pct}%
                      </span>
                      <span className="w-10 text-right tabular-nums">
                        {d.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Recent transactions</CardDescription>
          <CardTitle className="text-xl">Latest paperwork</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No transactional emails yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="text-xs">{r.vendor ?? "—"}</code>
                    </TableCell>
                    <TableCell className="capitalize text-xs">
                      {r.document_type ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {r.amount || "—"}
                    </TableCell>
                    <TableCell className="max-w-xs truncate" title={r.subject}>
                      <Link
                        to={`/v2/emails?id=${r.id}`}
                        className="text-sm hover:underline"
                      >
                        {r.subject}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {timeAgo(r.processed_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
