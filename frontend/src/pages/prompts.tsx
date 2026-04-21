import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { SystemPrompt, AIPrompt } from "@/lib/types";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function PromptEditor({
  prompt,
  defaultContent,
  onSaved,
}: {
  prompt: SystemPrompt;
  defaultContent?: string;
  onSaved: () => void;
}) {
  const [content, setContent] = useState(prompt.content || '');
  const isEmpty = !prompt.content || prompt.content.trim() === '';

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
          placeholder={isEmpty && defaultContent ? `Default:\n\n${defaultContent}` : ''}
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

function DefaultPromptDisplay({ type, content }: { type: string; content: string }) {
  const isEmpty = !content || content.trim() === '';
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          <code>{type}</code>
        </CardTitle>
        {isEmpty && (
          <p className="text-xs text-muted-foreground mt-1">
            (Uses built-in AI prompt; customize in the editor above)
          </p>
        )}
      </CardHeader>
      {!isEmpty && (
        <CardContent className="pt-0">
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
            {content}
          </pre>
        </CardContent>
      )}
    </Card>
  );
}

export default function PromptsPage() {
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [aiAnalyze, setAIAnalyze] = useState<AIPrompt | null>(null);
  const [aiActions, setAIActions] = useState<AIPrompt | null>(null);
  const [defaults, setDefaults] = useState<Array<{ type: string; content: string }>>([]);
  const [loading, setLoading] = useState(true);

  const loadPrompts = () => {
    Promise.all([
      api.getPrompts().then((data) => {
        setPrompts(data.prompts ?? []);
        setAIAnalyze(data.ai_analyze);
        setAIActions(data.ai_actions);
      }),
      api.getDefaultPrompts().then((data) => {
        setDefaults(data.defaults ?? []);
      }),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(loadPrompts, []);

  const handleInitDefaults = async () => {
    await api.initDefaults();
    loadPrompts();
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;

  // Filter to show only bucket prompts in v2 UI
  const bucketPrompts = prompts.filter((p) => p.type.startsWith('bucket_'));
  const bucketDefaults = defaults.filter((d) => d.type.startsWith('bucket_'));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pipeline Prompts</h1>
        <div className="flex gap-2">
          {bucketPrompts.length === 0 && (
            <Button onClick={handleInitDefaults}>Initialize Defaults</Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="current" className="w-full">
        <TabsList>
          <TabsTrigger value="current">Your Prompts</TabsTrigger>
          <TabsTrigger value="defaults">Built-in Defaults</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-4">
          {bucketPrompts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No custom bucket prompts yet. Click "Initialize Defaults" to create them, then customize below.
            </p>
          ) : (
            bucketPrompts.map((prompt) => {
              const defaultForType = bucketDefaults.find((d) => d.type === prompt.type);
              return (
                <PromptEditor
                  key={prompt.id}
                  prompt={prompt}
                  defaultContent={defaultForType?.content}
                  onSaved={loadPrompts}
                />
              );
            })
          )}

          {(aiAnalyze || aiActions) && (
            <>
              <Separator className="my-6" />
              <h3 className="text-lg font-semibold">AI-Generated Prompts</h3>
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
        </TabsContent>

        <TabsContent value="defaults" className="space-y-4">
          <p className="text-sm text-muted-foreground">
            These are the built-in default prompts for each pipeline stage. Click "Initialize Defaults" to copy them to your custom prompts, then edit them above.
          </p>
          <div className="space-y-4">
            {bucketDefaults.map((item) => (
              <DefaultPromptDisplay key={item.type} type={item.type} content={item.content} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
