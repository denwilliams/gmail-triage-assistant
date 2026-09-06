import { useEffect, useState } from "react";
import type { DeleteReviewResponse, DeleteReviewRow } from "@/lib/types";
import { api } from "@/lib/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function tierLabel(tier: string): string {
  // "🗑️/1m" -> "1m"
  return tier.split("/")[1] ?? tier;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export default function V2DeleteReviewPage() {
  const [data, setData] = useState<DeleteReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api
      .getDeleteReview()
      .then((d) => {
        setData(d);
        setSelected(new Set());
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Failed");
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const rows = data?.rows ?? [];
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleKeepSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await api.exemptFromDelete([...selected]);
      load();
    } catch (e) {
      alert("Failed to keep selected: " + (e instanceof Error ? e.message : "Unknown"));
    } finally {
      setBusy(false);
    }
  };

  const handleRunDelete = async () => {
    setConfirmOpen(false);
    setBusy(true);
    try {
      const result = await api.runDeleteSweep();
      setLastRun(
        `Trashed ${result.trashed}.` +
          (result.remaining > 0 ? ` ${result.remaining} more due — run again.` : "") +
          (result.errors > 0 ? ` ${result.errors} failed — check logs.` : ""),
      );
      load();
    } catch (e) {
      alert("Delete sweep failed: " + (e instanceof Error ? e.message : "Unknown"));
    } finally {
      setBusy(false);
    }
  };

  const dueCount = data?.due_total ?? 0;

  if (loading && !data) return <p className="text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-destructive">Failed: {error}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Delete review</h2>
        <p className="text-sm text-muted-foreground">
          Everything currently tagged <code className="text-xs">🗑️/*</code> for
          deletion. Automatic deletion is off — nothing here is removed unless
          you run it below. Deleted messages go to Gmail Trash, not permanently
          erased (recoverable there for ~30 days).
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardDescription>{data.total} labeled total</CardDescription>
          <CardTitle className="flex items-baseline gap-2 text-xl">
            <span>{dueCount} due now</span>
            <span className="text-sm font-normal text-muted-foreground">
              {data.tiers.map((t) => `${tierLabel(t.tier)}: ${t.due}/${t.total}`).join(" · ")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {lastRun && <p className="text-sm text-muted-foreground">{lastRun}</p>}

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || selected.size === 0}
              onClick={handleKeepSelected}
            >
              Keep selected ({selected.size})
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || dueCount === 0}
              onClick={() => setConfirmOpen(true)}
            >
              Run delete ({dueCount} due)
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing tagged for deletion right now.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <DeleteReviewTableRow
                    key={row.id}
                    row={row}
                    checked={selected.has(row.id)}
                    onToggle={() => toggleRow(row.id)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run delete sweep?</DialogTitle>
            <DialogDescription>
              This will move {dueCount} email{dueCount === 1 ? "" : "s"} to Gmail
              Trash. They're recoverable there for about 30 days. Anything not
              yet past its tier's age cutoff is left alone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRunDelete}>
              Trash {dueCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeleteReviewTableRow({
  row,
  checked,
  onToggle,
}: {
  row: DeleteReviewRow;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell>
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${row.subject}`}
        />
      </TableCell>
      <TableCell className="max-w-xs truncate font-medium">{row.subject}</TableCell>
      <TableCell className="max-w-[14rem] truncate text-muted-foreground">
        {row.from}
      </TableCell>
      <TableCell>
        <Badge variant="outline">{tierLabel(row.tier)}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDate(row.processed_at)}</TableCell>
      <TableCell>
        {row.due ? (
          <Badge variant="destructive">due</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">not yet</span>
        )}
      </TableCell>
    </TableRow>
  );
}
