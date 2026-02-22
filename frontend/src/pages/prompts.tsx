import { useEffect, useState } from "react";
import type { SystemPrompt, AIPrompt } from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function PromptEditor({
  prompt,
  onSaved,
}: {
  prompt: SystemPrompt;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(prompt.content);

  const handleSave = async () => {
    await api.updatePrompt(prompt.type, content);
    onSaved();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <code>{prompt.type}</code>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className="font-mono text-sm"
        />
        <Button size="sm" onClick={handleSave}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function AIPromptDisplay({ prompt, label }: { prompt: AIPrompt; label: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            <code>{label}</code>
          </CardTitle>
          <Badge variant="secondary">v{prompt.version}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Created: {new Date(prompt.created_at).toLocaleString()}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
          {prompt.content}
        </pre>
      </CardContent>
    </Card>
  );
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [aiAnalyze, setAIAnalyze] = useState<AIPrompt | null>(null);
  const [aiActions, setAIActions] = useState<AIPrompt | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPrompts = () => {
    api
      .getPrompts()
      .then((data) => {
        setPrompts(data.prompts ?? []);
        setAIAnalyze(data.ai_analyze);
        setAIActions(data.ai_actions);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(loadPrompts, []);

  const handleInitDefaults = async () => {
    await api.initDefaults();
    loadPrompts();
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">System Prompts</h1>
        {prompts.length === 0 && (
          <Button onClick={handleInitDefaults}>Initialize Defaults</Button>
        )}
      </div>

      <div className="space-y-4">
        {prompts.map((prompt) => (
          <PromptEditor key={prompt.id} prompt={prompt} onSaved={loadPrompts} />
        ))}
      </div>

      {(aiAnalyze || aiActions) && (
        <>
          <Separator />
          <h2 className="text-xl font-semibold">AI-Generated Prompts</h2>
          <div className="space-y-4">
            {aiAnalyze && (
              <AIPromptDisplay prompt={aiAnalyze} label="email_analyze" />
            )}
            {aiActions && (
              <AIPromptDisplay prompt={aiActions} label="email_actions" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
