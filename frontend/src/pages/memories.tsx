import { useEffect, useState } from "react";
import type { Memory } from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const typeColors: Record<string, string> = {
  daily: "border-l-blue-500",
  weekly: "border-l-green-500",
  monthly: "border-l-orange-500",
  yearly: "border-l-purple-500",
};

const typeBadgeVariant: Record<string, string> = {
  daily: "bg-blue-100 text-blue-800",
  weekly: "bg-green-100 text-green-800",
  monthly: "bg-orange-100 text-orange-800",
  yearly: "bg-purple-100 text-purple-800",
};

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);

  const loadMemories = () => {
    api
      .getMemories()
      .then((data) => setMemories(data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(loadMemories, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await api.generateMemory();
      loadMemories();
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateAI = async () => {
    setGeneratingAI(true);
    try {
      await api.generateAIPrompts();
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingAI(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Memories</h1>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? "Generating..." : "Generate Daily Memory"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateAI}
            disabled={generatingAI}
          >
            {generatingAI ? "Generating..." : "Generate AI Prompts"}
          </Button>
        </div>
      </div>

      {memories.length === 0 ? (
        <p className="text-muted-foreground">No memories yet.</p>
      ) : (
        memories.map((memory) => (
          <Card
            key={memory.id}
            className={cn("border-l-4", typeColors[memory.type])}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">
                  <span
                    className={cn(
                      "inline-block rounded px-2 py-0.5 text-xs font-medium",
                      typeBadgeVariant[memory.type]
                    )}
                  >
                    {memory.type}
                  </span>
                </CardTitle>
                <Badge variant="outline" className="text-xs">
                  {new Date(memory.start_date).toLocaleDateString()} –{" "}
                  {new Date(memory.end_date).toLocaleDateString()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <pre className="whitespace-pre-wrap text-sm">{memory.content}</pre>
              <p className="mt-2 text-xs text-muted-foreground">
                Created: {new Date(memory.created_at).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
