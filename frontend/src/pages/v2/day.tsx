import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "@/lib/api";
import type {
  Bucket,
  DayEmail,
  DaySenderGroup,
  DayVendorGroup,
  DayView,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BUCKET_OPTIONS,
  BUCKET_STYLES,
  InterestingScoreChip,
  SeverityUrgencyChips,
} from "@/components/v2/badges";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Receipt,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";

function isValidDate(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatDate(date: string, tz?: string): string {
  // Render the date in the server's configured timezone so the label matches
  // the day boundaries used to query.
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: tz,
  });
}

function formatTime(iso: string, tz?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

function formatEventTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

// Set from the server response so dates render in env.TIMEZONE.
const TimezoneCtx = createContext<string | undefined>(undefined);
const useTZ = () => useContext(TimezoneCtx);

function senderDisplay(addr: string): { name: string; email: string } {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: addr, email: addr };
}

// ----- Building blocks -----------------------------------------------------

function EmailLine({
  email,
  meta,
}: {
  email: DayEmail;
  meta?: React.ReactNode;
}) {
  const tz = useTZ();
  return (
    <li className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{email.subject || "(no subject)"}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatTime(email.processed_at, tz)}
          </span>
          {meta}
        </div>
        {email.summary && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {email.summary}
          </p>
        )}
      </div>
    </li>
  );
}

function SectionShell({
  bucket,
  title,
  description,
  count,
  icon: Icon,
  children,
}: {
  bucket: Bucket;
  title: string;
  description: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    // mb-4 + break-inside-avoid let the parent's multi-column layout flow
    // sections cleanly without splitting a card across columns.
    // py-3 + gap-2 tighten the card so the header doesn't dominate.
    <Card className="mb-4 break-inside-avoid py-3 gap-2">
      <CardHeader className="pb-1 gap-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              BUCKET_STYLES[bucket],
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="flex-1 min-w-0">
            <CardTitle className="flex items-baseline gap-2 text-base">
              <span>{title}</span>
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {count}
              </span>
            </CardTitle>
            <CardDescription
              className="truncate text-xs"
              title={description}
            >
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this bucket today.</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

// ----- Bucket renderers ----------------------------------------------------

function HumanSection({ groups }: { groups: DaySenderGroup[] }) {
  return (
    <ul className="space-y-4">
      {groups.map((g) => {
        const display = senderDisplay(g.from_address);
        return (
          <li key={g.from_address} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                to={`/senders?identifier=${encodeURIComponent(display.email)}&type=sender`}
                className="truncate text-sm font-semibold hover:underline"
                title={g.from_address}
              >
                {display.name}
                {display.name !== display.email && (
                  <span className="ml-1 font-normal text-muted-foreground">
                    &lt;{display.email}&gt;
                  </span>
                )}
              </Link>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {g.rating !== null && (
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 tabular-nums",
                      g.rating >= 40
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
                    )}
                    title={g.rating_manual ? "Manual rating" : "Auto-learned rating"}
                  >
                    rating {g.rating}
                  </span>
                )}
                <span className="tabular-nums">{g.emails.length}</span>
              </div>
            </div>
            <ul className="divide-y rounded-md border bg-muted/30 px-3">
              {g.emails.map((e) => (
                <EmailLine key={e.id} email={e} />
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function NewsletterSection({ emails }: { emails: DayEmail[] }) {
  return (
    <ul className="divide-y">
      {emails.map((e) => (
        <EmailLine
          key={e.id}
          email={e}
          meta={
            <>
              <span className="text-xs text-muted-foreground truncate">
                {senderDisplay(e.from_address).name}
              </span>
              {e.interesting_score !== null && (
                <InterestingScoreChip
                  score={e.interesting_score}
                  reasons={e.interesting_reasons}
                />
              )}
            </>
          }
        />
      ))}
    </ul>
  );
}

function NotificationSection({ emails }: { emails: DayEmail[] }) {
  return (
    <ul className="divide-y">
      {emails.map((e) => (
        <EmailLine
          key={e.id}
          email={e}
          meta={
            <>
              <span className="text-xs text-muted-foreground truncate">
                {senderDisplay(e.from_address).name}
              </span>
              <SeverityUrgencyChips severity={e.severity} urgency={e.urgency} />
            </>
          }
        />
      ))}
    </ul>
  );
}

function SecuritySection({ emails }: { emails: DayEmail[] }) {
  return (
    <ul className="divide-y">
      {emails.map((e) => (
        <EmailLine
          key={e.id}
          email={e}
          meta={
            <>
              <span className="text-xs text-muted-foreground truncate">
                {senderDisplay(e.from_address).name}
              </span>
              {e.action_type && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium uppercase text-red-800 dark:bg-red-500/25 dark:text-red-200">
                  {e.action_type.replace(/_/g, " ")}
                </span>
              )}
              {e.is_otp && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium uppercase text-amber-900 dark:bg-amber-500/25 dark:text-amber-100">
                  otp
                </span>
              )}
            </>
          }
        />
      ))}
    </ul>
  );
}

function TransactionalSection({ groups }: { groups: DayVendorGroup[] }) {
  return (
    <ul className="space-y-4">
      {groups.map((g) => (
        <li key={g.vendor} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold">{g.vendor}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {g.emails.length}
            </span>
          </div>
          <ul className="divide-y rounded-md border bg-muted/30 px-3">
            {g.emails.map((e) => (
              <EmailLine
                key={e.id}
                email={e}
                meta={
                  <>
                    {e.document_type && (
                      <span className="text-[11px] uppercase text-muted-foreground">
                        {e.document_type}
                      </span>
                    )}
                    {e.amount && (
                      <span className="text-xs font-medium tabular-nums">
                        {e.amount}
                      </span>
                    )}
                  </>
                }
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function CalendarSection({ emails }: { emails: DayEmail[] }) {
  const tz = useTZ();
  return (
    <ul className="divide-y">
      {emails.map((e) => (
        <EmailLine
          key={e.id}
          email={e.event_title ? { ...e, subject: e.event_title } : e}
          meta={
            <>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatEventTime(e.event_starts_at, tz)}
              </span>
              {e.event_location && (
                <span className="text-xs text-muted-foreground truncate">
                  @ {e.event_location}
                </span>
              )}
            </>
          }
        />
      ))}
    </ul>
  );
}

// ----- Page ----------------------------------------------------------------

export default function DayPage() {
  const params = useParams();
  const navigate = useNavigate();
  // Date param is optional. When absent, the server resolves to its
  // configured-timezone "today".
  const dateParam = isValidDate(params.date) ? params.date : undefined;

  const [view, setView] = useState<DayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDay(dateParam)
      .then((v) => {
        if (!cancelled) setView(v);
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
  }, [dateParam]);

  const date = view?.date ?? dateParam ?? "";
  const isToday = view ? view.date === view.today : !dateParam;
  const orderedBuckets: Bucket[] = useMemo(
    () => ["human", "newsletter", "notification", "security", "transactional", "calendar"],
    [],
  );

  // Ensure no rogue bucket sneaks in.
  for (const b of orderedBuckets) {
    if (!BUCKET_OPTIONS.includes(b)) throw new Error(`unknown bucket ${b}`);
  }

  return (
    <TimezoneCtx.Provider value={view?.timezone}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => view && navigate(`/day/${view.prev_date}`)}
            disabled={!view}
            aria-label="Previous day"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tabular-nums">
              {date ? formatDate(date, view?.timezone) : "—"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isToday ? "Today" : date}
              {view ? ` · ${view.total} emails` : ""}
              {view?.timezone && view.timezone !== "UTC" && (
                <span className="ml-1">({view.timezone})</span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => view && navigate(`/day/${view.next_date}`)}
            disabled={!view || view.next_date > view.today}
            aria-label="Next day"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            max={view?.today}
            onChange={(e) => {
              if (e.target.value) navigate(`/day/${e.target.value}`);
            }}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          />
          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/day`)}>
              Today
            </Button>
          )}
        </div>
      </div>

      {loading && !view && <p className="text-muted-foreground">Loading...</p>}
      {error && <p className="text-destructive">Failed: {error}</p>}

      {view && view.total === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No emails processed on this day.
          </CardContent>
        </Card>
      )}

      {view && view.total > 0 && (
        // CSS columns instead of a grid — sections are uneven in height, and
        // columns flow them masonry-style without leaving gaps under the
        // shorter cards.
        <div className="gap-4 md:columns-2 xl:columns-3">
          {orderedBuckets.map((bucket) => {
            const count = view.bucket_totals[bucket] ?? 0;
            switch (bucket) {
              case "human":
                return (
                  <SectionShell
                    key={bucket}
                    bucket="human"
                    title="Humans"
                    description="Grouped by sender"
                    count={count}
                    icon={UserRound}
                  >
                    <HumanSection groups={view.sections.human.groups} />
                  </SectionShell>
                );
              case "newsletter":
                return (
                  <SectionShell
                    key={bucket}
                    bucket="newsletter"
                    title="Newsletters"
                    description="Ordered by interestingness"
                    count={count}
                    icon={Sparkles}
                  >
                    <NewsletterSection emails={view.sections.newsletter.emails} />
                  </SectionShell>
                );
              case "notification":
                return (
                  <SectionShell
                    key={bucket}
                    bucket="notification"
                    title="Notifications"
                    description="Ordered by severity then urgency"
                    count={count}
                    icon={Inbox}
                  >
                    <NotificationSection emails={view.sections.notification.emails} />
                  </SectionShell>
                );
              case "security":
                return (
                  <SectionShell
                    key={bucket}
                    bucket="security"
                    title="Security"
                    description="Login alerts first, OTPs last"
                    count={count}
                    icon={ShieldAlert}
                  >
                    <SecuritySection emails={view.sections.security.emails} />
                  </SectionShell>
                );
              case "transactional":
                return (
                  <SectionShell
                    key={bucket}
                    bucket="transactional"
                    title="Transactional"
                    description="Grouped by vendor"
                    count={count}
                    icon={Receipt}
                  >
                    <TransactionalSection groups={view.sections.transactional.groups} />
                  </SectionShell>
                );
              case "calendar":
                return (
                  <SectionShell
                    key={bucket}
                    bucket="calendar"
                    title="Calendar"
                    description="Chronological event order"
                    count={count}
                    icon={CalendarDays}
                  >
                    <CalendarSection emails={view.sections.calendar.emails} />
                  </SectionShell>
                );
            }
            return null;
          })}
        </div>
      )}
    </div>
    </TimezoneCtx.Provider>
  );
}
