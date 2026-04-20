import { useEffect, useState } from "react";
import { Link } from "react-router";
import type {
  PipelineConfig,
  PipelineOps,
  StuckEmailRow,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BucketBadge, StageBadge } from "@/components/v2/badges";

function StageCountsRow({
  counts,
}: {
  counts: V2PipelineStats["stage_counts"];
}) {
  const entries: { stage: "queued" | "bucketed" | "processed" | "failed"; label: string; hint: string }[] = [
    { stage: "queued", label: "Queued", hint: "triage not yet run" },
    { stage: "bucketed", label: "Bucketed", hint: "triage done, stage 2 pending" },
    { stage: "processed", label: "Processed", hint: "fully processed" },
    { stage: "failed", label: "Failed", hint: "max retries exhausted" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {entries.map((e) => {
        const n = counts[e.stage] ?? 0;
        return (
          <Card key={e.stage}>
            <CardHeader className="pb-2">
              <CardDescription>
                {e.label}
                <span className="ml-1 text-[11px] opacity-70">— {e.hint}</span>
              </CardDescription>
              <CardTitle
                className={cn(
                  "text-2xl tabular-nums",
                  e.stage === "failed" && n > 0
                    ? "text-red-700 dark:text-red-400"
                    : "",
                )}
              >
                {n.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}

function ThroughputChart({
  data,
}: {
  data: PipelineOps["daily_throughput"];
}) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pipeline activity in the last 14 days.
      </p>
    );
  }
  const max = Math.max(
    1,
    ...data.map((d) => d.processed + d.failed),
  );
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d) => {
        const procH = (d.processed / max) * 100;
        const failH = (d.failed / max) * 100;
        return (
          <div
            key={d.date}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d.date}: ${d.processed} processed, ${d.failed} failed`}
          >
            <div className="flex w-full flex-1 items-end">
              <div className="flex w-full flex-col-reverse">
                <div
                  className="w-full bg-emerald-500/80 rounded-b-sm"
                  style={{ height: `${procH}%` }}
                />
                {d.failed > 0 && (
                  <div
                    className="w-full bg-red-500/80 rounded-t-sm"
                    style={{ height: `${failH}%` }}
                  />
                )}
              </div>
            </div>
            <span className="text-[9px] tabular-nums text-muted-foreground">
              {d.date.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StuckRow({
  email,
  actionLabel,
  onRetry,
}: {
  email: StuckEmailRow;
  actionLabel: string;
  onRetry: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const handle = async () => {
    setBusy(true);
    try {
      await onRetry(email.id);
      setDone(true);
    } catch (e) {
      alert("Retry failed: " + (e instanceof Error ? e.message : "Unknown"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={email.pipeline_stage} />
          {email.bucket && <BucketBadge bucket={email.bucket} />}
          <Link
            to={`/emails?id=${email.id}`}
            className="truncate text-sm font-medium hover:underline"
          >
            {email.subject}
          </Link>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {email.from_address} · created {timeAgo(email.created_at)}
        </div>
        {email.reasoning && (
          <p className="mt-1 text-xs italic text-muted-foreground line-clamp-2">
            {email.reasoning}
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant={done ? "ghost" : "outline"}
        onClick={handle}
        disabled={busy || done}
        className="shrink-0"
      >
        {done ? "✓ queued" : busy ? "..." : actionLabel}
      </Button>
    </li>
  );
}

function StageModelTable({ config }: { config: PipelineConfig }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Stage</TableHead>
          <TableHead>Effective model</TableHead>
          <TableHead>Override</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {config.stages.map((s) => (
          <TableRow key={s.stage}>
            <TableCell className="font-medium capitalize">
              {s.stage.replace("_", " ")}
            </TableCell>
            <TableCell>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {s.effective_model || "(unset)"}
              </code>
            </TableCell>
            <TableCell>
              {s.configured_model ? (
                <span className="text-xs">explicit</span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  falls back to default
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function V2PipelinePage() {
  const [stats, setStats] = useState<V2PipelineStats | null>(null);
  const [ops, setOps] = useState<PipelineOps | null>(null);
  const [config, setConfig] = useState<PipelineConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.getV2PipelineStats(),
      api.getPipelineOps(),
      api.getPipelineConfig(),
    ])
      .then(([s, o, c]) => {
        setStats(s);
        setOps(o);
        setConfig(c);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRetry = async (id: string) => {
    await api.retryPipelineEmail(id);
    // Optimistic remove — the email won't be stuck/failed anymore once queued.
    setOps((prev) =>
      prev
        ? {
            ...prev,
            stuck: prev.stuck.filter((e) => e.id !== id),
            failed: prev.failed.filter((e) => e.id !== id),
          }
        : prev,
    );
  };

  if (loading && !stats) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Failed: {error}</p>;
  if (!stats || !ops || !config) return null;

  const totalWeek = ops.daily_throughput.reduce(
    (acc, d) => ({ processed: acc.processed + d.processed, failed: acc.failed + d.failed }),
    { processed: 0, failed: 0 },
  );
  const failureRate =
    totalWeek.processed + totalWeek.failed > 0
      ? (
          (totalWeek.failed / (totalWeek.processed + totalWeek.failed)) *
          100
        ).toFixed(1)
      : "0";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Pipeline</h2>
        <p className="text-sm text-muted-foreground">
          Queue depths, throughput, and configuration for the v2 processing
          pipeline.
        </p>
      </div>

      <StageCountsRow counts={stats.stage_counts} />

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Last 14 days</CardDescription>
          <CardTitle className="flex items-baseline gap-3 text-xl">
            <span>Daily throughput</span>
            <span className="text-sm font-normal text-muted-foreground">
              {totalWeek.processed.toLocaleString()} processed ·{" "}
              <span
                className={cn(
                  totalWeek.failed > 0 ? "text-red-600 dark:text-red-400" : "",
                )}
              >
                {totalWeek.failed.toLocaleString()} failed ({failureRate}%)
              </span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ThroughputChart data={ops.daily_throughput} />
          <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-emerald-500/80" />
              processed
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-red-500/80" />
              failed
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>
            Older than 1 hour, still in queued or bucketed state
          </CardDescription>
          <CardTitle className="flex items-baseline gap-2 text-xl">
            <span>Stuck emails</span>
            <span className="text-sm font-normal text-muted-foreground">
              {ops.stuck.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ops.stuck.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing stuck — pipeline's flowing.
            </p>
          ) : (
            <ul className="divide-y">
              {ops.stuck.map((e) => (
                <StuckRow
                  key={e.id}
                  email={e}
                  actionLabel="Retry"
                  onRetry={handleRetry}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>
            Hit max retries on a v2 queue — worker logs will have details
          </CardDescription>
          <CardTitle className="flex items-baseline gap-2 text-xl">
            <span>Failed emails</span>
            <span className="text-sm font-normal text-muted-foreground">
              {ops.failed.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ops.failed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No failures. Nice.
            </p>
          ) : (
            <ul className="divide-y">
              {ops.failed.map((e) => (
                <StuckRow
                  key={e.id}
                  email={e}
                  actionLabel="Retry"
                  onRetry={handleRetry}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>
            Configured via{" "}
            <code className="text-xs">OPENAI_MODEL_*</code> worker vars
          </CardDescription>
          <CardTitle className="flex items-baseline gap-2 text-xl">
            <span>Per-stage models</span>
            <span className="text-sm font-normal text-muted-foreground">
              default:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {config.default_model || "(unset)"}
              </code>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StageModelTable config={config} />
          {config.openai_base_url && (
            <p className="mt-3 text-xs text-muted-foreground">
              Endpoint: <code>{config.openai_base_url}</code>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
