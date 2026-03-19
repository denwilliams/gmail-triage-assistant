import { useEffect, useState, useRef, useCallback } from "react";
import type { SenderProfile } from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

function timeAgo(dateStr: string): string {
  if (!dateStr) return "N/A";
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function topEntries(
  counts: Record<string, number> | undefined | null,
  n = 5
): [string, number][] {
  if (!counts) return [];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

const senderTypeBadgeColor: Record<string, string> = {
  human: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  newsletter:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  automated: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  marketing:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  notification:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
};

function SenderTypeBadge({ type }: { type: string }) {
  if (!type) return null;
  const colorClass =
    senderTypeBadgeColor[type] ||
    "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {type}
    </span>
  );
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

function ProfileDetailDialog({
  profile,
  open,
  onOpenChange,
  onProfileUpdated,
}: {
  profile: SenderProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileUpdated: (updated: SenderProfile) => void;
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
      onProfileUpdated(updated);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await api.generateSenderProfile(
        profile.profile_type,
        profile.identifier
      );
      if (res.ai_error) alert(`AI error: ${res.ai_error}`);
      onProfileUpdated(res.profile);
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
          {/* Stats */}
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

          {/* Sender Type */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Sender Type
            </span>
            <select
              value={editSenderType}
              onChange={(e) => setEditSenderType(e.target.value)}
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Unknown</option>
              <option value="human">Human</option>
              <option value="newsletter">Newsletter</option>
              <option value="automated">Automated</option>
              <option value="marketing">Marketing</option>
              <option value="notification">Notification</option>
            </select>
          </div>

          {/* Summary */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">
              Summary
            </span>
            <Textarea
              value={editSummary}
              onChange={(e) => setEditSummary(e.target.value)}
              rows={3}
              className="text-sm"
            />
            {hasChanges && (
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>

          {/* Regenerate */}
          <div className="flex items-center gap-2">
            {!confirmRegen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmRegen(true)}
              >
                Regenerate Profile
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

          {/* Top Slugs */}
          {slugEntries.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Top Slugs
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

          {/* Top Labels */}
          {labelEntries.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Top Labels
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

          {/* Top Keywords */}
          {keywordEntries.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Top Keywords
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

export default function SendersPage() {
  const [tab, setTab] = useState<"sender" | "domain">("sender");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<SenderProfile | null>(
    null
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const loadProfiles = useCallback(
    (offset = 0) => {
      const isLoadMore = offset > 0;
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      api
        .getAllSenderProfiles({
          type: tab,
          search: debouncedSearch || undefined,
          limit: PAGE_SIZE,
          offset,
        })
        .then((data) => {
          const results = data.profiles ?? [];
          if (isLoadMore) {
            setProfiles((prev) => [...prev, ...results]);
          } else {
            setProfiles(results);
          }
          setTotal(data.total ?? 0);
        })
        .catch(console.error)
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [tab, debouncedSearch]
  );

  useEffect(() => {
    loadProfiles(0);
  }, [loadProfiles]);

  const hasMore = profiles.length < total;

  const handleProfileUpdated = (updated: SenderProfile) => {
    setProfiles((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    setSelectedProfile(updated);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Senders</h1>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <Button
          variant={tab === "sender" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("sender")}
        >
          Senders
        </Button>
        <Button
          variant={tab === "domain" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("domain")}
        >
          Domains
        </Button>
      </div>

      {/* Search */}
      <Input
        placeholder={`Search ${tab === "sender" ? "email addresses" : "domains"}...`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      {/* Results count */}
      {!loading && (
        <p className="text-sm text-muted-foreground">
          {total} {tab === "sender" ? "sender" : "domain"} profile
          {total !== 1 ? "s" : ""}
          {debouncedSearch ? ` matching "${debouncedSearch}"` : ""}
        </p>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : profiles.length === 0 ? (
        <p className="text-muted-foreground">
          {debouncedSearch
            ? "No profiles match your search."
            : "No profiles found."}
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {tab === "sender" ? "Email" : "Domain"}
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead className="text-right">Archived</TableHead>
                <TableHead>Last Seen</TableHead>
                <TableHead className="hidden md:table-cell">Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((profile) => {
                const archiveRate =
                  profile.email_count > 0
                    ? Math.round(
                        (profile.emails_archived / profile.email_count) * 100
                      )
                    : 0;
                return (
                  <TableRow
                    key={profile.id}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => setSelectedProfile(profile)}
                  >
                    <TableCell className="max-w-[200px] truncate font-medium">
                      {profile.identifier}
                    </TableCell>
                    <TableCell>
                      <SenderTypeBadge type={profile.sender_type} />
                    </TableCell>
                    <TableCell className="text-right">
                      {profile.email_count}
                    </TableCell>
                    <TableCell className="text-right">
                      {archiveRate}%
                    </TableCell>
                    <TableCell>{timeAgo(profile.last_seen_at)}</TableCell>
                    <TableCell className="hidden max-w-[250px] truncate text-muted-foreground md:table-cell">
                      {profile.summary
                        ? profile.summary.length > 60
                          ? profile.summary.slice(0, 60) + "..."
                          : profile.summary
                        : "-"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Load more */}
      {hasMore && profiles.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={() => loadProfiles(profiles.length)}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      {/* Detail dialog */}
      {selectedProfile && (
        <ProfileDetailDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => {
            if (!open) setSelectedProfile(null);
          }}
          onProfileUpdated={handleProfileUpdated}
        />
      )}
    </div>
  );
}
