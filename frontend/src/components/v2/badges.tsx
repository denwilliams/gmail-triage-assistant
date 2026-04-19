import type { Bucket, TriageVia, PipelineStage, BucketConsistency } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const BUCKET_OPTIONS: Bucket[] = [
  "newsletter",
  "notification",
  "human",
  "transactional",
  "security",
  "calendar",
];

// Tuned for readable contrast in both light and dark themes.
export const BUCKET_STYLES: Record<Bucket, string> = {
  newsletter:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200",
  notification:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  human:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  transactional:
    "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  security:
    "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
  calendar:
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-200",
};

// Solid swatches for charts / dot indicators (higher saturation than chip bg).
export const BUCKET_CHART_COLORS: Record<Bucket, string> = {
  newsletter: "#3b82f6",
  notification: "#f59e0b",
  human: "#10b981",
  transactional: "#8b5cf6",
  security: "#ef4444",
  calendar: "#06b6d4",
};

export function BucketBadge({ bucket }: { bucket: Bucket }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent capitalize", BUCKET_STYLES[bucket])}
    >
      {bucket}
    </Badge>
  );
}

export const TRIAGE_VIA_LABELS: Record<TriageVia, string> = {
  ai: "AI",
  thread_reply: "Thread",
  consistent_sender: "Known sender",
};

export const TRIAGE_VIA_TITLES: Record<TriageVia, string> = {
  ai: "Triaged by AI",
  thread_reply: "Inherited from an earlier thread reply",
  consistent_sender: "Fast-pathed via a consistent sender profile",
};

export function TriageViaChip({ via }: { via: TriageVia }) {
  return (
    <Badge variant="outline" className="text-xs" title={TRIAGE_VIA_TITLES[via]}>
      {TRIAGE_VIA_LABELS[via]}
    </Badge>
  );
}

export const SEVERITY_STYLES: Record<string, string> = {
  critical:
    "bg-red-100 text-red-800 dark:bg-red-500/25 dark:text-red-200",
  high:
    "bg-orange-100 text-orange-800 dark:bg-orange-500/25 dark:text-orange-200",
  medium:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  low:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
};

export function SeverityUrgencyChips({
  severity,
  urgency,
}: {
  severity?: string | null;
  urgency?: string | null;
}) {
  return (
    <>
      {severity && (
        <Badge
          variant="outline"
          className={cn(
            "text-xs capitalize border-transparent",
            SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.low,
          )}
          title={`Severity: ${severity}`}
        >
          sev: {severity}
        </Badge>
      )}
      {urgency && (
        <Badge
          variant="outline"
          className={cn(
            "text-xs capitalize border-transparent",
            SEVERITY_STYLES[urgency] ?? SEVERITY_STYLES.low,
          )}
          title={`Urgency: ${urgency}`}
        >
          urg: {urgency}
        </Badge>
      )}
    </>
  );
}

export function InterestingScoreChip({
  score,
  reasons,
}: {
  score: number;
  reasons?: string[];
}) {
  const tooltip =
    reasons && reasons.length > 0 ? reasons[0] : `Interesting score ${score}/10`;
  return (
    <Badge variant="outline" className="text-xs" title={tooltip}>
      score {score}/10
    </Badge>
  );
}

export const CONSISTENCY_STYLES: Record<BucketConsistency, string> = {
  consistent:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  mixed:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
  unknown:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
};

export function ConsistencyBadge({ value }: { value: BucketConsistency }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent capitalize", CONSISTENCY_STYLES[value])}
    >
      {value}
    </Badge>
  );
}

export const STAGE_STYLES: Record<PipelineStage, string> = {
  queued:
    "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200",
  bucketed:
    "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200",
  processed:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  failed:
    "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
};

export function StageBadge({ stage }: { stage: PipelineStage }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent capitalize", STAGE_STYLES[stage])}
    >
      {stage}
    </Badge>
  );
}
