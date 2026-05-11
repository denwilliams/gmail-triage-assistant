import { useEffect, useState } from "react";
import type { Bucket, UserSettings, V2SettingsUpdate } from "@/lib/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BUCKET_OPTIONS, BucketBadge } from "@/components/v2/badges";

const USER_IDENTITY_MAX_LEN = 4000;

type NotifyMap = Partial<Record<Bucket, boolean>>;

interface DraftSettings {
  newsletter: number;
  human: number;
  calendar: number;
  notifyBuckets: NotifyMap;
  identity: string;
}

interface ThresholdDistribution {
  score: number;
  count: number;
}

interface HumanRatingDistribution {
  rating_bucket: string;
  count: number;
}

function fromSettings(s: UserSettings): DraftSettings {
  return {
    newsletter: s.v2_newsletter_threshold,
    human: s.v2_human_rating_threshold,
    calendar: s.v2_calendar_imminent_minutes,
    notifyBuckets: { ...s.v2_notify_buckets },
    identity: s.user_identity ?? "",
  };
}

function settingsEqual(a: DraftSettings, b: DraftSettings): boolean {
  if (
    a.newsletter !== b.newsletter ||
    a.human !== b.human ||
    a.calendar !== b.calendar ||
    a.identity !== b.identity
  ) {
    return false;
  }
  for (const bucket of BUCKET_OPTIONS) {
    if ((a.notifyBuckets[bucket] ?? true) !== (b.notifyBuckets[bucket] ?? true)) {
      return false;
    }
  }
  return true;
}

function SliderRow({
  label,
  description,
  min,
  max,
  step,
  value,
  unit,
  onChange,
  colourClass,
  distribution,
}: {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
  colourClass: string;
  distribution?: Array<{ score?: number; count: number }>;
}) {
  const maxCount = distribution ? Math.max(...distribution.map((d) => d.count), 1) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded px-2 py-0.5 text-sm font-medium tabular-nums",
              colourClass,
            )}
          >
            {value}
            {unit ? <span className="ml-0.5 text-[11px] opacity-70">{unit}</span> : null}
          </span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer accent-primary"
      />
      {distribution && (
        <div className="flex h-12 items-end gap-0.5 rounded border border-border bg-muted/30 p-1">
          {distribution.map((d, i) => {
            let bucketEnd = i * 10 + 9;
            if (i === distribution.length - 1) bucketEnd = 100;
            const isBelowThreshold = bucketEnd < value;

            return (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-sm transition-colors",
                  isBelowThreshold ? "bg-amber-400/60" : "bg-emerald-400/50"
                )}
                style={{
                  height: `${Math.max(d.count > 0 ? 16 : 0, (d.count / maxCount) * 100)}%`,
                }}
                title={`${d.count} email${d.count !== 1 ? "s" : ""}`}
              />
            );
          })}
        </div>
      )}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>
          {min}
          {unit ?? ""}
        </span>
        <span>
          {max}
          {unit ?? ""}
        </span>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export default function V2SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [draft, setDraft] = useState<DraftSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [newsletterDistribution, setNewsletterDistribution] = useState<ThresholdDistribution[]>([]);
  const [humanRatingDistribution, setHumanRatingDistribution] = useState<HumanRatingDistribution[]>([]);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.getSettings(),
      api.getNewsletterThresholdDistribution(),
      api.getHumanRatingThresholdDistribution(),
    ])
      .then(([s, nlDist, hrDist]) => {
        setSettings(s);
        setDraft(fromSettings(s));
        setNewsletterDistribution(nlDist.distribution);
        setHumanRatingDistribution(hrDist.distribution);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const canSave =
    !saving && settings && draft && !settingsEqual(draft, fromSettings(settings));

  const pushoverOrWebhook =
    settings?.pushover_configured || settings?.webhook_configured;

  const handleSave = async () => {
    if (!settings || !draft) return;
    setSaving(true);
    try {
      const body: V2SettingsUpdate = {};
      const orig = fromSettings(settings);
      if (draft.newsletter !== orig.newsletter) body.newsletter_threshold = draft.newsletter;
      if (draft.human !== orig.human) body.human_rating_threshold = draft.human;
      if (draft.calendar !== orig.calendar) body.calendar_imminent_minutes = draft.calendar;
      if (draft.identity !== orig.identity) body.user_identity = draft.identity;

      // Always send notify_buckets if any changed — send the full map for
      // clarity so the server state matches the UI exactly.
      const notifyChanged = BUCKET_OPTIONS.some(
        (b) => (draft.notifyBuckets[b] ?? true) !== (orig.notifyBuckets[b] ?? true),
      );
      if (notifyChanged) {
        const cleaned: NotifyMap = {};
        for (const b of BUCKET_OPTIONS) {
          // Only include explicit false values to keep the stored map small —
          // missing keys default to true on the server.
          if (draft.notifyBuckets[b] === false) cleaned[b] = false;
        }
        body.notify_buckets = cleaned;
      }

      await api.updateV2Settings(body);
      // Refresh from server so the masked values stay in sync.
      await load();
      setSavedAt(Date.now());
    } catch (e) {
      alert("Save failed: " + (e instanceof Error ? e.message : "Unknown"));
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!settings) return;
    setDraft(fromSettings(settings));
  };

  if (loading && !settings) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Failed: {error}</p>;
  if (!settings || !draft) return null;

  const newsletterColour =
    draft.newsletter >= 7
      ? "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200"
      : draft.newsletter >= 4
        ? "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200"
        : "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100";
  const humanColour =
    draft.human >= 60
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
      : draft.human >= 30
        ? "bg-slate-100 text-slate-700 dark:bg-slate-500/25 dark:text-slate-200"
        : "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Per-user overrides for thresholds and notification routing. Defaults
          apply if you don't change anything.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>
            Helps the AI recognise you in From / To / Cc headers and email
            bodies — so it doesn't draft replies on your own outbound mail
            or treat group emails as if every question were aimed at you.
          </CardDescription>
          <CardTitle className="text-xl">Your identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={draft.identity}
            onChange={(e) =>
              setDraft({ ...draft, identity: e.target.value.slice(0, USER_IDENTITY_MAX_LEN) })
            }
            placeholder={`Free-form. For example:\n\nMy name is Dennis. Also goes by Den, Denlie.\nEmail aliases: dennis@oldjob.com, dennis.smith@personal.com\nI work as a software engineer at Acme.`}
            rows={6}
            className="font-mono text-xs"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>
              Your primary Gmail address is passed to the AI automatically —
              only add names, aliases, and other addresses here.
            </span>
            <span>
              {draft.identity.length} / {USER_IDENTITY_MAX_LEN}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Digest inclusion</CardDescription>
          <CardTitle className="text-xl">Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <SliderRow
            label="Newsletter interesting threshold"
            description="Newsletters scoring this or higher are included in the daily digest. Default 6."
            min={0}
            max={10}
            step={1}
            value={draft.newsletter}
            onChange={(v) => setDraft({ ...draft, newsletter: v })}
            colourClass={newsletterColour}
            distribution={newsletterDistribution}
          />
          <SliderRow
            label="Human rating threshold"
            description="Human senders below this rating get archived and surfaced in the quiet-humans digest. Default 40."
            min={0}
            max={100}
            step={5}
            value={draft.human}
            onChange={(v) => setDraft({ ...draft, human: v })}
            colourClass={humanColour}
            distribution={humanRatingDistribution}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>Calendar</CardDescription>
          <CardTitle className="text-xl">Imminent-event window</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Calendar events starting within this window trigger a push /
            webhook notification when first seen. 0 disables. Default 60
            minutes.
          </p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              max={1440}
              value={draft.calendar}
              onChange={(e) =>
                setDraft({ ...draft, calendar: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })
              }
              className="h-9 w-24"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
            {draft.calendar === 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                imminent-event notifications disabled
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>
            Which buckets can trigger push / webhook notifications
          </CardDescription>
          <CardTitle className="text-xl">Notification routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!pushoverOrWebhook && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-800 dark:text-amber-200">
              You haven't configured Pushover or a webhook yet — these toggles
              will take effect once you do, via Settings → Notifications.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Disabling a bucket suppresses all Pushover and webhook
            notifications for that bucket — regardless of what the processor
            decided internally. Daily digests are unaffected.
          </p>
          <ul className="divide-y">
            {BUCKET_OPTIONS.map((bucket) => {
              const enabled = draft.notifyBuckets[bucket] !== false;
              return (
                <li
                  key={bucket}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <BucketBadge bucket={bucket} />
                    <span className="text-xs text-muted-foreground">
                      {bucketHint(bucket)}
                    </span>
                  </div>
                  <Toggle
                    checked={enabled}
                    onChange={(v) =>
                      setDraft({
                        ...draft,
                        notifyBuckets: {
                          ...draft.notifyBuckets,
                          [bucket]: v,
                        },
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-2">
        {savedAt && !canSave && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Saved
          </span>
        )}
        <Button variant="ghost" onClick={handleDiscard} disabled={!canSave}>
          Discard
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function bucketHint(bucket: Bucket): string {
  switch (bucket) {
    case "newsletter":
      return "never notifies by default";
    case "notification":
      return "high / critical severity";
    case "human":
      return "high-rated senders only";
    case "transactional":
      return "never notifies by default";
    case "security":
      return "always notifies — fast lane";
    case "calendar":
      return "imminent events only";
  }
}
