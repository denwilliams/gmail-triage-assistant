import { useEffect, useState } from "react";
import type { Email } from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function EmailCard({ email, onFeedbackSaved }: { email: Email; onFeedbackSaved: () => void }) {
  const [feedback, setFeedback] = useState(email.human_feedback || "");
  const [open, setOpen] = useState(false);

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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-medium leading-snug">
            {email.subject}
            {email.bypassed_inbox && (
              <Badge variant="secondary" className="ml-2 text-xs">
                Archived
              </Badge>
            )}
          </CardTitle>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{email.from_address}</span>
          <span className="text-xs">·</span>
          <code className="text-xs">{email.slug}</code>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-sm">{email.summary}</p>

        {email.keywords?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {email.keywords.map((kw) => (
              <code key={kw} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {kw}
              </code>
            ))}
          </div>
        )}

        {email.labels_applied?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {email.labels_applied.map((label) => (
              <Badge key={label} variant="outline">
                {label}
              </Badge>
            ))}
          </div>
        )}

        {email.reasoning && (
          <p className="text-sm italic text-muted-foreground">
            {email.reasoning}
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Processed: {new Date(email.processed_at).toLocaleString()}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setOpen(!open)}
          >
            {open ? "Hide" : "Feedback"}
          </Button>
        </div>

        {open && (
          <div className="space-y-2 border-t pt-3">
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
        )}
      </CardContent>
    </Card>
  );
}

export default function HistoryPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Email History</h1>
      {emails.length === 0 ? (
        <p className="text-muted-foreground">No processed emails yet.</p>
      ) : (
        emails.map((email) => (
          <EmailCard key={email.id} email={email} onFeedbackSaved={loadEmails} />
        ))
      )}
    </div>
  );
}
