import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { CalendarBucketStats, CalendarEventRef } from "@/lib/types";
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

function formatEventTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(mins / 60);
  const days = Math.round(hours / 24);
  const suffix = diff < 0 ? " ago" : "";
  const prefix = diff > 0 ? "in " : "";
  if (mins < 60) return `${prefix}${mins}m${suffix}`;
  if (hours < 48) return `${prefix}${hours}h${suffix}`;
  return `${prefix}${days}d${suffix}`;
}

function isImminent(iso: string | null): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const diff = ms - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

function EventRow({ event, isPast }: { event: CalendarEventRef; isPast?: boolean }) {
  const imminent = !isPast && isImminent(event.event_starts_at);
  return (
    <li className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <div
        className={cn(
          "mt-0.5 flex min-w-24 shrink-0 flex-col items-end rounded px-2 py-1 text-right text-xs tabular-nums",
          imminent
            ? "bg-cyan-100 text-cyan-900 dark:bg-cyan-500/25 dark:text-cyan-100"
            : isPast
              ? "bg-muted text-muted-foreground"
              : "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
        )}
      >
        <span className="font-medium">{formatEventTime(event.event_starts_at)}</span>
        <span className="text-[10px] opacity-70">
          {formatRelative(event.event_starts_at)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <Link
          to={`/emails?id=${event.id}`}
          className="block hover:underline"
        >
          <div className="truncate text-sm font-medium">
            {event.event_title || event.subject}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-muted-foreground">
            {event.event_location && (
              <span title="Location">📍 {event.event_location}</span>
            )}
            {event.event_attendees.length > 0 && (
              <span title="Attendees">👥 {event.event_attendees.length}</span>
            )}
            <span>from {event.from_address}</span>
            <span>· received {timeAgo(event.processed_at)}</span>
          </div>
        </Link>
      </div>
    </li>
  );
}

export default function CalendarBucketPage() {
  const [stats, setStats] = useState<CalendarBucketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getBucketStats("calendar")
      .then((s) => {
        if (cancelled) return;
        if (s.bucket !== "calendar") throw new Error("bucket mismatch");
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
      <BucketPageHeader bucket="calendar" totals={stats.totals} />

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>What's coming up</CardDescription>
          <CardTitle className="flex items-baseline gap-2 text-xl">
            <span>Upcoming events</span>
            <span className="text-sm font-normal text-muted-foreground">
              {stats.upcoming.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming events extracted.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.upcoming.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Recent past</CardDescription>
            <CardTitle className="text-xl">What just happened</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recent_past.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No past events recorded.
              </p>
            ) : (
              <ul className="divide-y">
                {stats.recent_past.map((e) => (
                  <EventRow key={e.id} event={e} isPast />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Undated</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {stats.undated_count}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Calendar-bucketed emails without a parseable start date — usually
              cancellations, updates, or free-text event discussions.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
