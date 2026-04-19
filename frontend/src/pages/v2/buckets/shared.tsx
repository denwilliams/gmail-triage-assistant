import { Link } from "react-router";
import type { Bucket, BucketTotals } from "@/lib/types";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BucketBadge } from "@/components/v2/badges";
import { cn } from "@/lib/utils";

// Short blurb per bucket — shown under the header so each page announces its
// purpose without duplicating the bucket's code.
const BUCKET_BLURBS: Record<Bucket, string> = {
  newsletter: "Score-curated reading. Everything archived, digest surfaces the interesting stuff.",
  notification: "System alerts and monitoring. Severity × urgency decides inbox vs archive.",
  human: "Personal correspondence. Sender rating gates inbox vs quiet-humans digest.",
  transactional: "Receipts, invoices, shipping. Vendor-labelled with timed auto-delete.",
  security: "MFA, password resets, login alerts. Fast-lane to inbox + push.",
  calendar: "Event invites and updates. Timeline of what's coming up.",
};

export function BucketPageHeader({
  bucket,
  totals,
}: {
  bucket: Bucket;
  totals: BucketTotals;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link to="/v2" className="hover:underline">
          Dashboard
        </Link>
        <span>/</span>
        <Link to="/v2/emails" className="hover:underline">
          Buckets
        </Link>
        <span>/</span>
        <BucketBadge bucket={bucket} />
      </div>
      <div>
        <h2 className="text-xl font-semibold capitalize">{bucket}</h2>
        <p className="text-sm text-muted-foreground">{BUCKET_BLURBS[bucket]}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(
          [
            ["Last 7 days", totals.week],
            ["Last 30 days", totals.month],
            ["All time", totals.all_time],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {value.toLocaleString()}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function BucketLinkButton({
  to,
  label,
}: {
  to: string;
  label: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors",
        "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      {label} →
    </Link>
  );
}
