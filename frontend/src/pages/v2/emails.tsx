import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type {
  Bucket,
  Email,
  PipelineStage,
  TriageVia,
} from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  STAGE_STYLES,
  StageBadge,
  TRIAGE_VIA_LABELS,
  TRIAGE_VIA_STYLES,
  TriageViaChip,
} from "@/components/v2/badges";

const PAGE_SIZE = 50;
const PIPELINE_STAGES: PipelineStage[] = ["bucketed", "processed", "failed"];
const TRIAGE_VIAS: TriageVia[] = ["ai", "thread_reply", "consistent_sender"];

function EmailRow({ email, onClick }: { email: Email; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {email.bucket && <BucketBadge bucket={email.bucket} />}
          <span className="truncate text-sm font-medium">{email.subject}</span>
          {email.pipeline_stage && email.pipeline_stage !== "processed" && (
            <StageBadge stage={email.pipeline_stage} />
          )}
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
          {email.included_in_digest && (
            <Badge variant="outline" className="text-xs" title="Included in a daily digest">
              digest
            </Badge>
          )}
        </div>
      </div>
      {email.labels_applied?.length > 0 && (
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {email.labels_applied.slice(0, 3).map((label) => (
            <Badge key={label} variant="outline" className="text-xs">
              {label}
            </Badge>
          ))}
        </div>
      )}
    </button>
  );
}

function EmailDetailDialog({
  email,
  open,
  onOpenChange,
}: {
  email: Email;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-start gap-2 text-base leading-snug">
            <span className="flex-1">{email.subject}</span>
          </DialogTitle>
          <DialogDescription className="text-left">
            {email.from_address}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {email.bucket && <BucketBadge bucket={email.bucket} />}
            {email.pipeline_stage && (
              <StageBadge stage={email.pipeline_stage} />
            )}
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
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <span className="font-medium text-muted-foreground">Summary</span>
            <span>{email.summary || "—"}</span>
            <span className="font-medium text-muted-foreground">Processed</span>
            <span>{new Date(email.processed_at).toLocaleString()}</span>
            {email.included_in_digest && (
              <>
                <span className="font-medium text-muted-foreground">
                  In digest
                </span>
                <span>{email.included_in_digest}</span>
              </>
            )}
            {email.thread_id && (
              <>
                <span className="font-medium text-muted-foreground">
                  Thread
                </span>
                <code className="text-xs">{email.thread_id}</code>
              </>
            )}
          </div>

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

          {email.labels_applied.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Labels
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {email.labels_applied.map((l) => (
                  <Badge key={l} variant="outline">
                    {l}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {email.reasoning && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">
                Processor reasoning
              </span>
              <p className="mt-1 text-sm italic text-muted-foreground">
                {email.reasoning}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type FilterPillProps = {
  label: string;
  active: boolean;
  activeClass?: string;
  onClick: () => void;
};

function FilterPill({ label, active, activeClass, onClick }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs capitalize transition-colors",
        active
          ? activeClass ??
              "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label}
    </button>
  );
}

export default function V2EmailsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const bucketFilter =
    (searchParams.get("bucket") as Bucket | null) ?? null;
  const stageFilter =
    (searchParams.get("pipeline_stage") as PipelineStage | null) ?? null;
  const viaFilter =
    (searchParams.get("triage_via") as TriageVia | null) ?? null;
  const selectedId = searchParams.get("id");

  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const buildFilters = () => ({
    v2_only: true,
    ...(bucketFilter && { bucket: bucketFilter }),
    ...(stageFilter && { pipeline_stage: stageFilter }),
    ...(viaFilter && { triage_via: viaFilter }),
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getEmails(PAGE_SIZE, 0, buildFilters())
      .then((data) => {
        if (cancelled) return;
        const results = data ?? [];
        setEmails(results);
        setHasMore(results.length >= PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucketFilter, stageFilter, viaFilter]);

  const loadMore = () => {
    setLoadingMore(true);
    api
      .getEmails(PAGE_SIZE, emails.length, buildFilters())
      .then((data) => {
        const results = data ?? [];
        setEmails((prev) => [...prev, ...results]);
        setHasMore(results.length >= PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false));
  };

  const setQueryParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    next.delete("id");
    setSearchParams(next, { replace: false });
  };

  const openEmail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("id", id);
    setSearchParams(next, { replace: false });
  };

  const closeEmail = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("id");
    setSearchParams(next, { replace: false });
  };

  const selected = selectedId
    ? emails.find((e) => e.id === selectedId) ?? null
    : null;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Bucket
          </span>
          <FilterPill
            label="All"
            active={bucketFilter === null}
            onClick={() => setQueryParam("bucket", null)}
          />
          {BUCKET_OPTIONS.map((b) => (
            <FilterPill
              key={b}
              label={b}
              active={bucketFilter === b}
              activeClass={cn("border-transparent", BUCKET_STYLES[b])}
              onClick={() => setQueryParam("bucket", b)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Stage
          </span>
          <FilterPill
            label="All"
            active={stageFilter === null}
            onClick={() => setQueryParam("pipeline_stage", null)}
          />
          {PIPELINE_STAGES.map((s) => (
            <FilterPill
              key={s}
              label={s}
              active={stageFilter === s}
              activeClass={cn("border-transparent", STAGE_STYLES[s])}
              onClick={() => setQueryParam("pipeline_stage", s)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Path
          </span>
          <FilterPill
            label="All"
            active={viaFilter === null}
            onClick={() => setQueryParam("triage_via", null)}
          />
          {TRIAGE_VIAS.map((v) => (
            <FilterPill
              key={v}
              label={TRIAGE_VIA_LABELS[v]}
              active={viaFilter === v}
              activeClass={cn("border-transparent", TRIAGE_VIA_STYLES[v])}
              onClick={() => setQueryParam("triage_via", v)}
            />
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : emails.length === 0 ? (
        <p className="text-muted-foreground">
          No v2 emails match these filters.
        </p>
      ) : (
        <div className="space-y-1">
          {emails.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              onClick={() => openEmail(email.id)}
            />
          ))}
        </div>
      )}

      {!loading && hasMore && emails.length > 0 && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      {selected && (
        <EmailDetailDialog
          email={selected}
          open
          onOpenChange={(open) => {
            if (!open) closeEmail();
          }}
        />
      )}
    </div>
  );
}
