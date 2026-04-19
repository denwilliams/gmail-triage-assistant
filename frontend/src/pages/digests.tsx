import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DailyDigest } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DigestsPage() {
  const [digests, setDigests] = useState<DailyDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DailyDigest | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setLoading(true);
    try {
      const resp = await api.listDigests(60);
      setDigests(resp.digests);
      if (!selected && resp.digests.length > 0) {
        setSelected(resp.digests[0]);
      }
    } catch (err) {
      console.error("Failed to load digests:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage("");
    try {
      await api.generateDigestNow();
      setMessage("Digest generated. Check your inbox.");
      await refresh();
    } catch (err) {
      setMessage(
        "Failed to generate digest: " + (err instanceof Error ? err.message : "Unknown error"),
      );
    } finally {
      setGenerating(false);
    }
  };

  if (loading && digests.length === 0) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Daily Digests</h1>
        <Button onClick={handleGenerate} disabled={generating}>
          {generating ? "Generating..." : "Generate now"}
        </Button>
      </div>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {digests.length === 0 ? (
        <p className="text-muted-foreground">
          No digests yet. Digests are composed at 8 AM for v2 pipeline users when
          there's at least one item to include. Flip your account to v2 in
          Settings, then use "Generate now" to create one on demand.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px,1fr]">
          <div className="space-y-1">
            {digests.map((d) => {
              const total =
                d.itemCounts.newsletters +
                d.itemCounts.notifications +
                d.itemCounts.quietHumans;
              const isSelected = selected?.id === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelected(d)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                      : "border-transparent hover:bg-accent"
                  }`}
                >
                  <div className="font-medium">{d.digestDate}</div>
                  <div className="text-xs text-muted-foreground">
                    {total} items · {d.itemCounts.newsletters} nl · {d.itemCounts.notifications} notif · {d.itemCounts.quietHumans} quiet
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {d.sentAt ? "sent" : "not sent"}
                  </div>
                </button>
              );
            })}
          </div>

          {selected && (
            <Card>
              <CardHeader>
                <CardTitle>{selected.digestDate}</CardTitle>
              </CardHeader>
              <CardContent>
                <iframe
                  title={`digest-${selected.digestDate}`}
                  srcDoc={selected.contentHtml}
                  className="w-full"
                  style={{ border: "1px solid var(--border)", minHeight: 600 }}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
