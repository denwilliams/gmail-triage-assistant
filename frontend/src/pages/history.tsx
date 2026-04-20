import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import type {
  Bucket,
  Email,
  SenderProfile,
  SenderProfilesResponse,
} from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, timeAgo } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  BUCKET_OPTIONS,
  BUCKET_STYLES,
  BucketBadge,
  InterestingScoreChip,
  SeverityUrgencyChips,
  TriageViaChip,
} from "@/components/v2/badges";

function topEntries(counts: Record<string, number>, n = 5): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function GenerateProfileButton({
  label,
  onGenerate,
}: {
  label: string;
  onGenerate: () => Promise<void>;
}) {
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await onGenerate();
    } catch (err) {
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleGenerate}
      disabled={generating}
    >
      {generating ? "Generating..." : label}
    </Button>
  );
}

function ProfileSection({
  title,
  profile,
  onUpdate,
  onRegenerate,
}: {
  title: string;
  profile: SenderProfile;
  onUpdate: (body: { summary?: string; label_counts?: Record<string, number> }) => void;
  onRegenerate: () => void;
}) {
  const [editSummary, setEditSummary] = useState(profile.summary || "");
  const [saving, setSaving] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const summaryChanged = editSummary !== (profile.summary || "");

  const archiveRate =
    profile.email_count > 0
      ? Math.round((profile.emails_archived / profile.email_count) * 100)
      : 0;
  const notifyRate =
    profile.email_count > 0
      ? Math.round((profile.emails_notified / profile.email_count) * 100)
      : 0;

  const handleSaveSummary = async () => {
    setSaving(true);
    try {
      onUpdate({ summary: editSummary });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveLabel = (label: string) => {
    const newCounts = { ...profile.label_counts };
    delete newCounts[label];
    onUpdate({ label_counts: newCounts });
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await onRegenerate();
      setConfirmRegen(false);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        {!confirmRegen ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => setConfirmRegen(true)}
          >
            Regenerate
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Overwrite profile?</span>
            <Button
              size="sm"
              variant="destructive"
              className="h-6 text-xs"
              onClick={handleRegenerate}
              disabled={regenerating}
            >
              {regenerating ? "Regenerating..." : "Confirm"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => setConfirmRegen(false)}
              disabled={regenerating}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {profile.sender_type && (
          <Badge variant="outline">{profile.sender_type}</Badge>
        )}
        <span className="text-muted-foreground">
          {profile.email_count} emails
        </span>
        <span className="text-muted-foreground">
          {archiveRate}% archived
        </span>
        <span className="text-muted-foreground">
          {notifyRate}% notified
        </span>
      </div>
      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          Summary
        </span>
        <Textarea
          value={editSummary}
          onChange={(e) => setEditSummary(e.target.value)}
          rows={2}
          className="text-sm"
        />
        {summaryChanged && (
          <Button size="sm" onClick={handleSaveSummary} disabled={saving}>
            Save Summary
          </Button>
        )}
      </div>
      {profile.slug_counts && Object.keys(profile.slug_counts).length > 0 && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">
            Top slugs:
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {topEntries(profile.slug_counts).map(([slug, count]) => (
              <code key={slug} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {slug} ({count})
              </code>
            ))}
          </div>
        </div>
      )}
      {profile.label_counts && Object.keys(profile.label_counts).length > 0 && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">
            Top labels:
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {topEntries(profile.label_counts).map(([label, count]) => (
              <Badge key={label} variant="outline" className="gap-1 text-xs">
                {label} ({count})
                <button
                  type="button"
                  onClick={() => handleRemoveLabel(label)}
                  className="ml-0.5 rounded-full hover:bg-destructive/20"
                  title={`Remove ${label}`}
                >
                  &times;
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EmailDetailDialog({
  email,
  open,
  onOpenChange,
  onFeedbackSaved,
}: {
  email: Email;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedbackSaved: () => void;
}) {
  const [feedback, setFeedback] = useState(email.human_feedback || "");
  const [profiles, setProfiles] = useState<SenderProfilesResponse | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setProfiles(null);
      return;
    }
    setFeedback(email.human_feedback || "");
    setProfilesLoading(true);
    api
      .getSenderProfiles(email.from_address)
      .then(setProfiles)
      .catch(console.error)
      .finally(() => setProfilesLoading(false));
  }, [open, email.from_address, email.human_feedback]);

  const handleSave = async () => {
    await api.updateFeedback(email.id, feedback);
    onFeedbackSaved();
  };

  const handleClear = async () => {
    setFeedback("");
    await api.updateFeedback(email.id, "");
    onFeedbackSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 text-base leading-snug">
            <span className="flex-1">{email.subject}</span>
            {email.bypassed_inbox && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                Archived
              </Badge>
            )}
            {email.notification_sent && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                Notified
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="text-left">
            {email.from_address}
          </DialogDescription>
          {email.bucket && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <BucketBadge bucket={email.bucket} />
              {email.triage_via && <TriageViaChip via={email.triage_via} />}
              {email.bucket === "notification" && (
                <SeverityUrgencyChips
                  severity={email.severity}
                  urgency={email.urgency}
                />
              )}
              {email.bucket === "newsletter" &&
                typeof email.interesting_score === "number" && (
                  <InterestingScoreChip
                    score={email.interesting_score}
                    reasons={email.interesting_reasons}
                  />
                )}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* Email Details */}
          <div className="space-y-2">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-muted-foreground">Slug</span>
              <code className="text-xs">{email.slug}</code>
              <span className="font-medium text-muted-foreground">Summary</span>
              <span>{email.summary}</span>
              <span className="font-medium text-muted-foreground">Processed</span>
              <span>{new Date(email.processed_at).toLocaleString()}</span>
            </div>

            {email.keywords?.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Keywords
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {email.keywords.map((kw) => (
                    <code
                      key={kw}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      {kw}
                    </code>
                  ))}
                </div>
              </div>
            )}

            {email.labels_applied?.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Labels
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {email.labels_applied.map((label) => (
                    <Badge key={label} variant="outline">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {email.triage_reasoning && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Triage reasoning
                </span>
                <p className="mt-1 text-sm italic text-muted-foreground">
                  {email.triage_reasoning}
                </p>
              </div>
            )}

            {email.bucket === "newsletter" &&
              email.interesting_reasons &&
              email.interesting_reasons.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-muted-foreground">
                    Why it&rsquo;s interesting
                  </span>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {email.interesting_reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}

            {email.reasoning && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Reasoning
                </span>
                <p className="mt-1 text-sm italic text-muted-foreground">
                  {email.reasoning}
                </p>
              </div>
            )}
          </div>

          {/* Feedback */}
          <div className="space-y-2 border-t pt-3">
            <span className="text-xs font-medium text-muted-foreground">
              Feedback
            </span>
            <Textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Tell the AI what to do differently next time..."
              rows={2}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
              {email.human_feedback && (
                <Button size="sm" variant="outline" onClick={handleClear}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          {/* Sender Profile */}
          <div className="border-t pt-3">
            {profilesLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading profiles...
              </p>
            ) : profiles?.sender ? (
              <ProfileSection
                title="Sender Profile"
                profile={profiles.sender}
                onUpdate={async (body) => {
                  const updated = await api.updateSenderProfile(profiles.sender!.id, body);
                  setProfiles((p) => p ? { ...p, sender: updated } : p);
                }}
                onRegenerate={async () => {
                  const res = await api.generateSenderProfile("sender", email.from_address);
                  if (res.ai_error) alert(`AI error: ${res.ai_error}`);
                  setProfiles((p) => p ? { ...p, sender: res.profile } : p);
                }}
              />
            ) : (
              <GenerateProfileButton
                label="Generate Sender Profile"
                onGenerate={async () => {
                  const res = await api.generateSenderProfile("sender", email.from_address);
                  if (res.ai_error) alert(`AI error: ${res.ai_error}`);
                  setProfiles((p) => p ? { ...p, sender: res.profile } : p);
                }}
              />
            )}
          </div>

          {/* Domain Profile */}
          <div className="border-t pt-3">
            {profilesLoading ? null : profiles?.domain ? (
              <ProfileSection
                title="Domain Profile"
                profile={profiles.domain}
                onUpdate={async (body) => {
                  const updated = await api.updateSenderProfile(profiles.domain!.id, body);
                  setProfiles((p) => p ? { ...p, domain: updated } : p);
                }}
                onRegenerate={async () => {
                  const domain = email.from_address.split("@")[1]?.replace(/[<>]/g, "");
                  if (!domain) return;
                  const res = await api.generateSenderProfile("domain", domain);
                  if (res.ai_error) alert(`AI error: ${res.ai_error}`);
                  setProfiles((p) => p ? { ...p, domain: res.profile } : p);
                }}
              />
            ) : (
              <GenerateProfileButton
                label="Generate Domain Profile"
                onGenerate={async () => {
                  const domain = email.from_address.split("@")[1]?.replace(/[<>]/g, "");
                  if (!domain) return;
                  const res = await api.generateSenderProfile("domain", domain);
                  if (res.ai_error) alert(`AI error: ${res.ai_error}`);
                  setProfiles((p) => p ? { ...p, domain: res.profile } : p);
                }}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmailRow({
  email,
  onClick,
}: {
  email: Email;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {email.feedback_dirty && (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500"
              title="Feedback pending inclusion in next memory"
            />
          )}
          {email.bucket && <BucketBadge bucket={email.bucket} />}
          <span className="truncate text-sm font-medium">{email.subject}</span>
          {email.bypassed_inbox && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              Archived
            </Badge>
          )}
          {email.notification_sent && (
            <Badge variant="secondary" className="shrink-0 text-xs">
              Notified
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{email.from_address}</span>
          <span>·</span>
          <code>{email.slug}</code>
          <span>·</span>
          <span>{timeAgo(email.processed_at)}</span>
          {email.triage_via && <TriageViaChip via={email.triage_via} />}
          {email.bucket === "notification" && (
            <SeverityUrgencyChips
              severity={email.severity}
              urgency={email.urgency}
            />
          )}
          {email.bucket === "newsletter" &&
            typeof email.interesting_score === "number" && (
              <InterestingScoreChip
                score={email.interesting_score}
                reasons={email.interesting_reasons}
              />
            )}
        </div>
      </div>
      {email.labels_applied?.length > 0 && (
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {email.labels_applied.map((label) => (
            <Badge key={label} variant="outline" className="text-xs">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </button>
  );
}

const PAGE_SIZE = 50;

export default function HistoryPage() {
  const { emailId } = useParams();
  const navigate = useNavigate();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [bucketFilter, setBucketFilter] = useState<Bucket | null>(null);

  const loadEmails = (bucket: Bucket | null) => {
    setLoading(true);
    api
      .getEmails(PAGE_SIZE, 0, bucket ?? undefined)
      .then((data) => {
        const results = data ?? [];
        setEmails(results);
        setHasMore(results.length >= PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const loadMore = () => {
    setLoadingMore(true);
    api
      .getEmails(PAGE_SIZE, emails.length, bucketFilter ?? undefined)
      .then((data) => {
        const results = data ?? [];
        setEmails((prev) => [...prev, ...results]);
        setHasMore(results.length >= PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  };

  useEffect(() => {
    loadEmails(bucketFilter);
  }, [bucketFilter]);

  const selected = emailId ? emails.find((e) => e.id === emailId) : null;

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Email History</h1>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setBucketFilter(null)}
          className={cn(
            "rounded-full border px-3 py-1 text-xs transition-colors",
            bucketFilter === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          All
        </button>
        {BUCKET_OPTIONS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBucketFilter(b)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
              bucketFilter === b
                ? cn("border-transparent", BUCKET_STYLES[b])
                : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {b}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : emails.length === 0 ? (
        <p className="text-muted-foreground">
          {bucketFilter
            ? `No ${bucketFilter} emails yet.`
            : "No processed emails yet."}
        </p>
      ) : (
        <div className="space-y-1">
          {emails.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              onClick={() => navigate(`/legacy-v1/history/${email.id}`)}
            />
          ))}
        </div>
      )}

      {!loading && hasMore && emails.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      {selected && (
        <EmailDetailDialog
          email={selected}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) navigate("/legacy-v1/history");
          }}
          onFeedbackSaved={() => loadEmails(bucketFilter)}
        />
      )}
    </div>
  );
}
