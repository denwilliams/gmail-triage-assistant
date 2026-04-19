import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type {
  Bucket,
  BucketConsistency,
  SenderProfile,
  SenderProfileSort,
} from "@/lib/types";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BUCKET_OPTIONS,
  BucketBadge,
  ConsistencyBadge,
} from "@/components/v2/badges";

const PAGE_SIZE = 50;

type RatingFilter = "all" | "null" | "manual" | "auto";

const SORT_OPTIONS: { value: SenderProfileSort; label: string }[] = [
  { value: "volume", label: "Volume" },
  { value: "recent", label: "Recent activity" },
  { value: "rating_high", label: "Rating (high → low)" },
  { value: "rating_low", label: "Rating (low → high)" },
  { value: "consistency", label: "Consistency" },
];

const CONSISTENCY_OPTIONS: BucketConsistency[] = [
  "consistent",
  "mixed",
  "unknown",
];

function RatingCell({
  profile,
  onUpdated,
}: {
  profile: SenderProfile;
  onUpdated: (p: SenderProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    profile.rating !== null ? String(profile.rating) : "",
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(profile.rating !== null ? String(profile.rating) : "");
    setEditing(false);
  }, [profile.id, profile.rating]);

  const handleSave = async () => {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 100) {
      alert("Rating must be 0-100");
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateSenderProfile(profile.id, {
        rating: parsed,
        rating_manual: true,
      });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleRateNow = async () => {
    setBusy(true);
    try {
      const updated = await api.rateSenderNow(profile.id);
      onUpdated(updated);
    } catch (err) {
      alert(
        "Rate failed: " +
          (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRevert = async () => {
    setBusy(true);
    try {
      const updated = await api.updateSenderProfile(profile.id, {
        rating: null,
      });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-sm"
        />
        <Button size="sm" onClick={handleSave} disabled={busy} className="h-7">
          Save
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
          disabled={busy}
          className="h-7"
        >
          Cancel
        </Button>
      </div>
    );
  }

  const ratingDisplay =
    profile.rating !== null ? (
      <span
        className={cn(
          "font-medium tabular-nums",
          profile.rating < 40 && "text-amber-600 dark:text-amber-400",
          profile.rating >= 80 && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {profile.rating}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );

  return (
    <div className="flex items-center gap-1.5">
      {ratingDisplay}
      {profile.rating_manual && profile.rating !== null && (
        <span
          className="text-[10px] font-medium uppercase text-muted-foreground"
          title="Manually overridden"
        >
          manual
        </span>
      )}
      <div className="ml-auto flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="h-6 px-2 text-xs"
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRateNow}
          disabled={busy}
          className="h-6 px-2 text-xs"
          title="Recompute rating via AI"
        >
          {busy ? "..." : "Rate"}
        </Button>
        {profile.rating !== null && profile.rating_manual && (
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRevert}
            disabled={busy}
            className="h-6 px-2 text-xs"
            title="Drop manual override"
          >
            Auto
          </Button>
        )}
      </div>
    </div>
  );
}

function BucketCountsCell({
  counts,
  primary,
}: {
  counts: Record<string, number>;
  primary: Bucket | null;
}) {
  const entries = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([bucket, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isPrimary = primary === bucket;
        return (
          <span
            key={bucket}
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              isPrimary
                ? "bg-primary/15 font-medium text-primary"
                : "bg-muted text-muted-foreground",
            )}
            title={`${count} emails (${pct}%)`}
          >
            {bucket} · {count}
          </span>
        );
      })}
    </div>
  );
}

export default function V2SendersPage() {
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<SenderProfileSort>("volume");
  const [consistency, setConsistency] = useState<BucketConsistency | null>(
    null,
  );
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all");
  const [page, setPage] = useState(0);

  const queryArgs = useMemo(
    () => ({
      type: "sender" as const,
      search: search || undefined,
      sort,
      consistency: consistency ?? undefined,
      bucket: bucket ?? undefined,
      rating_state:
        ratingFilter === "all"
          ? undefined
          : (ratingFilter as "null" | "manual" | "auto"),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [search, sort, consistency, bucket, ratingFilter, page],
  );

  const load = () => {
    setLoading(true);
    api
      .getAllSenderProfiles(queryArgs)
      .then((res) => {
        setProfiles(res.profiles ?? []);
        setTotal(res.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [queryArgs]);

  const updateProfile = (updated: SenderProfile) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p)),
    );
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {total.toLocaleString()} sender profile{total === 1 ? "" : "s"}
        </div>
        <form onSubmit={submitSearch} className="flex items-center gap-2">
          <Input
            placeholder="Search by email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-9 w-56"
          />
          <Button size="sm" type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap gap-4 border-b pb-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Sort</span>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SenderProfileSort);
              setPage(0);
            }}
            className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Consistency</span>
          <FilterPill
            label="Any"
            active={consistency === null}
            onClick={() => {
              setConsistency(null);
              setPage(0);
            }}
          />
          {CONSISTENCY_OPTIONS.map((c) => (
            <FilterPill
              key={c}
              label={c}
              active={consistency === c}
              onClick={() => {
                setConsistency(c);
                setPage(0);
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Primary bucket</span>
          <FilterPill
            label="Any"
            active={bucket === null}
            onClick={() => {
              setBucket(null);
              setPage(0);
            }}
          />
          {BUCKET_OPTIONS.map((b) => (
            <FilterPill
              key={b}
              label={b}
              active={bucket === b}
              onClick={() => {
                setBucket(b);
                setPage(0);
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Rating</span>
          {(["all", "null", "manual", "auto"] as const).map((r) => (
            <FilterPill
              key={r}
              label={
                r === "null" ? "unrated" : r === "all" ? "any" : r
              }
              active={ratingFilter === r}
              onClick={() => {
                setRatingFilter(r);
                setPage(0);
              }}
            />
          ))}
        </div>
      </div>

      {loading && profiles.length === 0 ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : profiles.length === 0 ? (
        <p className="text-muted-foreground">
          No sender profiles match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sender</TableHead>
                <TableHead>Consistency</TableHead>
                <TableHead>Buckets seen</TableHead>
                <TableHead className="w-56">Rating (0-100)</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-xs">
                    <Link
                      to={`/senders?identifier=${encodeURIComponent(p.identifier)}&type=sender`}
                      className="truncate text-sm hover:underline"
                      title={p.identifier}
                    >
                      {p.identifier}
                    </Link>
                    {p.sender_type && (
                      <div className="text-[11px] text-muted-foreground">
                        {p.sender_type}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <ConsistencyBadge value={p.bucket_consistency} />
                      {p.primary_bucket && (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          →<BucketBadge bucket={p.primary_bucket} />
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <BucketCountsCell
                      counts={p.bucket_counts}
                      primary={p.primary_bucket}
                    />
                  </TableCell>
                  <TableCell>
                    <RatingCell profile={p} onUpdated={updateProfile} />
                  </TableCell>
                  <TableCell className="tabular-nums text-sm">
                    {p.email_count}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {timeAgo(p.last_seen_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px] capitalize transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}
