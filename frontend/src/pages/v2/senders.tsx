import { useEffect, useMemo, useState } from "react";
import type {
  Bucket,
  BucketConsistency,
  ProfileType,
  SenderProfile,
  SenderProfileSort,
} from "@/lib/types";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const SENDER_TYPES: { value: string; label: string }[] = [
  { value: "", label: "Unknown" },
  { value: "newsletter", label: "Newsletter" },
  { value: "notification", label: "Notification" },
  { value: "human", label: "Human" },
  { value: "transactional", label: "Transactional" },
  { value: "security", label: "Security" },
  { value: "calendar", label: "Calendar" },
  { value: "mixed", label: "Mixed" },
];

function topEntries(
  counts: Record<string, number> | undefined | null,
  n = 5,
): [string, number][] {
  if (!counts) return [];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function CountBar({
  label,
  count,
  max,
}: {
  label: string;
  count: number;
  max: number;
}) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <code className="min-w-0 flex-1 truncate text-xs">{label}</code>
      <div className="h-2 w-24 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-foreground/30"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs text-muted-foreground">
        {count}
      </span>
    </div>
  );
}

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

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 99) {
      alert("Rating must be 0-99");
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

  const handleRateNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const handleRevert = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      <div className="flex items-center gap-1" onClick={stop}>
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
          onClick={(e) => {
            e.stopPropagation();
            setEditing(false);
          }}
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
    <div className="flex items-center gap-1.5" onClick={stop}>
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
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
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

function ProfileDetailDialog({
  profile,
  open,
  onOpenChange,
  onUpdated,
}: {
  profile: SenderProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (updated: SenderProfile) => void;
}) {
  const [editSummary, setEditSummary] = useState(profile.summary || "");
  const [editSenderType, setEditSenderType] = useState(profile.sender_type || "");
  const [saving, setSaving] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setEditSummary(profile.summary || "");
    setEditSenderType(profile.sender_type || "");
    setConfirmRegen(false);
  }, [profile.id, profile.summary, profile.sender_type]);

  const summaryChanged = editSummary !== (profile.summary || "");
  const typeChanged = editSenderType !== (profile.sender_type || "");
  const hasChanges = summaryChanged || typeChanged;

  const archiveRate =
    profile.email_count > 0
      ? Math.round((profile.emails_archived / profile.email_count) * 100)
      : 0;
  const notifyRate =
    profile.email_count > 0
      ? Math.round((profile.emails_notified / profile.email_count) * 100)
      : 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: { summary?: string; sender_type?: string } = {};
      if (summaryChanged) body.summary = editSummary;
      if (typeChanged) body.sender_type = editSenderType;
      const updated = await api.updateSenderProfile(profile.id, body);
      onUpdated(updated);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await api.generateSenderProfile(
        profile.profile_type,
        profile.identifier,
      );
      if (res.ai_error) alert(`AI error: ${res.ai_error}`);
      onUpdated(res.profile);
      setConfirmRegen(false);
    } finally {
      setRegenerating(false);
    }
  };

  const slugEntries = topEntries(profile.slug_counts);
  const labelEntries = topEntries(profile.label_counts);
  const keywordEntries = topEntries(profile.keyword_counts);
  const maxSlug = slugEntries.length > 0 ? slugEntries[0][1] : 1;
  const maxLabel = labelEntries.length > 0 ? labelEntries[0][1] : 1;
  const maxKeyword = keywordEntries.length > 0 ? keywordEntries[0][1] : 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex-1 truncate">{profile.identifier}</span>
          </DialogTitle>
          <DialogDescription className="text-left">
            {profile.profile_type === "sender" ? "Sender" : "Domain"} profile
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Emails</span>
              <p className="font-medium">{profile.email_count}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Archived</span>
              <p className="font-medium">
                {profile.emails_archived} ({archiveRate}%)
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Notified</span>
              <p className="font-medium">
                {profile.emails_notified} ({notifyRate}%)
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">First seen</span>
              <p className="font-medium">
                {profile.first_seen_at
                  ? new Date(profile.first_seen_at).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Last seen</span>
              <p className="font-medium">
                {profile.last_seen_at
                  ? new Date(profile.last_seen_at).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ConsistencyBadge value={profile.bucket_consistency} />
            {profile.primary_bucket && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                → <BucketBadge bucket={profile.primary_bucket} />
                <span>(fast-path)</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Sender Type
            </label>
            <select
              value={editSenderType}
              onChange={(e) => setEditSenderType(e.target.value)}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {SENDER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              Summary
            </label>
            <p className="text-[11px] text-muted-foreground">
              Fed to the AI during triage and bucket processing as sender
              context.
            </p>
            <Textarea
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              rows={4}
              className="text-sm"
              placeholder="Describe this sender/domain so the AI can triage their emails better..."
            />
            {hasChanges && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>

          {profile.rating_reasoning && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Rating reasoning
              </span>
              <p className="text-xs italic text-muted-foreground">
                {profile.rating_reasoning}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            {!confirmRegen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmRegen(true)}
              >
                Regenerate profile
              </Button>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">
                  Overwrite profile?
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRegenerate}
                  disabled={regenerating}
                >
                  {regenerating ? "Regenerating..." : "Confirm"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmRegen(false)}
                  disabled={regenerating}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>

          {slugEntries.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Top slugs
              </span>
              <div className="space-y-1">
                {slugEntries.map(([slug, count]) => (
                  <CountBar
                    key={slug}
                    label={slug}
                    count={count}
                    max={maxSlug}
                  />
                ))}
              </div>
            </div>
          )}

          {labelEntries.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Top labels
              </span>
              <div className="space-y-1">
                {labelEntries.map(([label, count]) => (
                  <CountBar
                    key={label}
                    label={label}
                    count={count}
                    max={maxLabel}
                  />
                ))}
              </div>
            </div>
          )}

          {keywordEntries.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Top keywords
              </span>
              <div className="space-y-1">
                {keywordEntries.map(([keyword, count]) => (
                  <CountBar
                    key={keyword}
                    label={keyword}
                    count={count}
                    max={maxKeyword}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function V2SendersPage() {
  const [profileType, setProfileType] = useState<ProfileType>("sender");
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
  const [selectedProfile, setSelectedProfile] = useState<SenderProfile | null>(
    null,
  );

  const queryArgs = useMemo(
    () => ({
      type: profileType,
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
    [profileType, search, sort, consistency, bucket, ratingFilter, page],
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
    setSelectedProfile((prev) =>
      prev && prev.id === updated.id ? updated : prev,
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
        <div className="flex items-center gap-2">
          <Button
            variant={profileType === "sender" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setProfileType("sender");
              setPage(0);
            }}
          >
            Senders
          </Button>
          <Button
            variant={profileType === "domain" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setProfileType("domain");
              setPage(0);
            }}
          >
            Domains
          </Button>
          <span className="ml-2 text-sm text-muted-foreground">
            {total.toLocaleString()} profile{total === 1 ? "" : "s"}
          </span>
        </div>
        <form onSubmit={submitSearch} className="flex items-center gap-2">
          <Input
            placeholder={
              profileType === "sender"
                ? "Search by email..."
                : "Search by domain..."
            }
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
          No {profileType} profiles match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {profileType === "sender" ? "Sender" : "Domain"}
                </TableHead>
                <TableHead>Consistency</TableHead>
                <TableHead>Buckets seen</TableHead>
                <TableHead className="w-56">Rating (0-99)</TableHead>
                <TableHead>Volume</TableHead>
                <TableHead>Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => setSelectedProfile(p)}
                >
                  <TableCell className="max-w-xs">
                    <div className="truncate text-sm" title={p.identifier}>
                      {p.identifier}
                    </div>
                    {p.sender_type && (
                      <div className="text-[11px] text-muted-foreground">
                        {p.sender_type}
                      </div>
                    )}
                    {p.summary && (
                      <div
                        className="mt-0.5 truncate text-[11px] text-muted-foreground"
                        title={p.summary}
                      >
                        {p.summary}
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

      {selectedProfile && (
        <ProfileDetailDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => {
            if (!open) setSelectedProfile(null);
          }}
          onUpdated={updateProfile}
        />
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
