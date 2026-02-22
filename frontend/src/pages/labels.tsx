import { useEffect, useState } from "react";
import type { Label } from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function LabelCard({
  label,
  onSaved,
  onDeleted,
}: {
  label: Label;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [description, setDescription] = useState(label.description);
  const [reasons, setReasons] = useState(label.reasons?.join("\n") ?? "");

  const handleSave = async () => {
    const reasonsList = reasons
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    await api.updateLabel(label.id, name.trim(), description.trim(), reasonsList);
    setEditing(false);
    onSaved();
  };

  const handleCancel = () => {
    setName(label.name);
    setDescription(label.description);
    setReasons(label.reasons?.join("\n") ?? "");
    setEditing(false);
  };

  const handleDelete = async () => {
    if (!confirm("Delete this label?")) return;
    await api.deleteLabel(label.id);
    onDeleted();
  };

  if (editing) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Helps AI understand when to use this label"
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Reasons (one per line)</label>
            <Textarea
              value={reasons}
              onChange={(e) => setReasons(e.target.value)}
              placeholder="Reason to apply this label..."
              rows={3}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave}>
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{label.name}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </div>
        {label.description && (
          <CardDescription>{label.description}</CardDescription>
        )}
      </CardHeader>
      {label.reasons?.length > 0 && (
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-1">
            {label.reasons.map((reason) => (
              <Badge key={reason} variant="secondary">
                {reason}
              </Badge>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function LabelsPage() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);

  const loadLabels = () => {
    api
      .getLabels()
      .then((data) => setLabels(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(loadLabels, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createLabel(name.trim(), description.trim());
    setName("");
    setDescription("");
    loadLabels();
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Labels</h1>

      <Card>
        <CardHeader>
          <CardTitle>Create Label</CardTitle>
          <CardDescription>
            Add a new Gmail label for email categorization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex items-end gap-3">
            <div className="flex-1 space-y-1">
              <label htmlFor="name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Label name"
                required
              />
            </div>
            <div className="flex-1 space-y-1">
              <label htmlFor="desc" className="text-sm font-medium">
                Description
              </label>
              <Input
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      {labels.length > 0 ? (
        <div className="space-y-3">
          {labels.map((label) => (
            <LabelCard
              key={label.id}
              label={label}
              onSaved={loadLabels}
              onDeleted={loadLabels}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">No labels configured yet.</p>
      )}
    </div>
  );
}
