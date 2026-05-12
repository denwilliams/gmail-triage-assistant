import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
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

// Per-breakpoint section assignment to columns. Each layout renders all six
// sections in a separate DOM subtree, hidden via `hidden` at the wrong
// breakpoints. This is required because there is no native masonry layout in
// stable browsers: a CSS grid would size each row by the tallest cell,
// leaving gaps under shorter cards. Splitting into independent flex columns
// lets each column pack tightly.
const LAYOUT_1COL: Bucket[] = [
  "human", "calendar", "security", "transactional", "newsletter", "notification",
];
const LAYOUT_2COL: Bucket[][] = [
  ["human", "transactional", "newsletter"],
  ["calendar", "security", "notification"],
];
const LAYOUT_3COL: Bucket[][] = [
  ["human", "transactional"],
  ["calendar", "newsletter"],
  ["security", "notification"],
];

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

// Collapsed max-heights — mobile is intentionally short so single-column
// pages stay scannable; the wider breakpoints get more room.
const COLLAPSED_HEIGHT = "max-h-64 md:max-h-[28rem]";

function CollapsibleBody({
  children,
  expanded,
  onToggle,
}: {
  children: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Only measure while collapsed. Once we know content overflows we keep the
  // button visible so users can collapse again after expanding. Three copies
  // of each section render across breakpoints (mobile/2-col/3-col) — the
  // hidden ones have clientHeight=0 and won't trigger overflow until they
  // become visible and ResizeObserver fires.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const check = () => {
      if (!ref.current) return;
      const { scrollHeight, clientHeight } = ref.current;
      // clientHeight is 0 for display:none ancestors — skip those so we don't
      // mark a hidden instance as non-overflowing.
      if (clientHeight === 0) return;
      setOverflows(scrollHeight > clientHeight + 4);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);

  return (
    <>
      <div
        ref={ref}
        className={cn(
          "relative",
          !expanded && cn("overflow-hidden", COLLAPSED_HEIGHT),
        )}
      >
        {children}
        {!expanded && overflows && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
          />
        )}
      </div>
      {overflows && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 w-full text-xs"
          onClick={onToggle}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </>
  );
}

function SectionShell({
  bucket,
  title,
  description,
  count,
  icon: Icon,
  expanded,
  onToggle,
  children,
}: {
  bucket: Bucket;
  title: string;
  description: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="py-3 gap-2">
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
          <CollapsibleBody expanded={expanded} onToggle={onToggle}>
            {children}
          </CollapsibleBody>
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
  // Expanded state is lifted to the parent so toggling on one breakpoint stays
  // in sync as the user resizes between mobile / 2-col / 3-col layouts (each
  // breakpoint renders its own copy of every section).
  const [expandedState, setExpandedState] = useState<Partial<Record<Bucket, boolean>>>({});
  const toggleExpanded = (b: Bucket) =>
    setExpandedState((s) => ({ ...s, [b]: !s[b] }));

  // Ensure no rogue bucket sneaks in.
  for (const b of LAYOUT_1COL) {
    if (!BUCKET_OPTIONS.includes(b)) throw new Error(`unknown bucket ${b}`);
  }

  function renderSection(bucket: Bucket): React.ReactNode {
    if (!view) return null;
    const count = view.bucket_totals[bucket] ?? 0;
    const expanded = !!expandedState[bucket];
    const onToggle = () => toggleExpanded(bucket);
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
            expanded={expanded}
            onToggle={onToggle}
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
            expanded={expanded}
            onToggle={onToggle}
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
            expanded={expanded}
            onToggle={onToggle}
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
            expanded={expanded}
            onToggle={onToggle}
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
            expanded={expanded}
            onToggle={onToggle}
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
            expanded={expanded}
            onToggle={onToggle}
          >
            <CalendarSection emails={view.sections.calendar.emails} />
          </SectionShell>
        );
    }
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
        // Three breakpoint-specific layouts, each rendered to the DOM and
        // hidden via `hidden` at the wrong width. Per-column flexbox lets each
        // column pack tightly without leaving gaps under shorter cards (which
        // is unavoidable with a regular CSS grid).
        <>
          {/* Mobile: single column */}
          <div className="md:hidden flex flex-col gap-4">
            {LAYOUT_1COL.map((b) => renderSection(b))}
          </div>

          {/* 2-col (md to xl) */}
          <div className="hidden md:grid xl:hidden grid-cols-2 gap-4 items-start">
            {LAYOUT_2COL.map((col, i) => (
              <div key={i} className="flex flex-col gap-4">
                {col.map((b) => renderSection(b))}
              </div>
            ))}
          </div>

          {/* 3-col (xl and up) */}
          <div className="hidden xl:grid grid-cols-3 gap-4 items-start">
            {LAYOUT_3COL.map((col, i) => (
              <div key={i} className="flex flex-col gap-4">
                {col.map((b) => renderSection(b))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
    </TimezoneCtx.Provider>
  );
}
