import { useEffect, useState } from "react";
import type { Label } from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  const handleDelete = async (id: number) => {
    await api.deleteLabel(id);
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

      {labels.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {labels.map((label) => (
                  <TableRow key={label.id}>
                    <TableCell className="font-medium">{label.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {label.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(label.id)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {labels.length === 0 && (
        <p className="text-muted-foreground">No labels configured yet.</p>
      )}
    </div>
  );
}
