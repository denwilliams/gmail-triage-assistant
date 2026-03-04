import { useEffect, useState } from "react";
import type { Email, SenderProfile, SenderProfilesResponse } from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

function timeAgo(dateStr: string): string {
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

function topEntries(counts: Record<string, number>, n = 5): [string, number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function ProfileSection({
  title,
  profile,
}: {
  title: string;
  profile: SenderProfile;
}) {
  const archiveRate =
    profile.email_count > 0
      ? Math.round((profile.emails_archived / profile.email_count) * 100)
      : 0;
  const notifyRate =
    profile.email_count > 0
      ? Math.round((profile.emails_notified / profile.email_count) * 100)
      : 0;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
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
      {profile.summary && (
        <p className="text-sm text-muted-foreground">{profile.summary}</p>
      )}
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
              <Badge key={label} variant="outline" className="text-xs">
                {label} ({count})
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
              <ProfileSection title="Sender Profile" profile={profiles.sender} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No sender profile available
              </p>
            )}
          </div>

          {/* Domain Profile */}
          {!profilesLoading && profiles?.domain && (
            <div className="border-t pt-3">
              <ProfileSection
                title="Domain Profile"
                profile={profiles.domain}
              />
            </div>
          )}
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
        <div className="flex items-center gap-2">
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
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{email.from_address}</span>
          <span>·</span>
          <code>{email.slug}</code>
          <span>·</span>
          <span>{timeAgo(email.processed_at)}</span>
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

export default function HistoryPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Email | null>(null);

  const loadEmails = () => {
    api
      .getEmails()
      .then((data) => setEmails(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(loadEmails, []);

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Email History</h1>
      {emails.length === 0 ? (
        <p className="text-muted-foreground">No processed emails yet.</p>
      ) : (
        <div className="space-y-1">
          {emails.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              onClick={() => setSelected(email)}
            />
          ))}
        </div>
      )}

      {selected && (
        <EmailDetailDialog
          email={selected}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onFeedbackSaved={loadEmails}
        />
      )}
    </div>
  );
}
