import { useState } from "react";
import { useNavigate } from "react-router";
import type {
  WizardQuestion,
  WizardAnswer,
  WizardPrompts,
} from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type WizardState = "loading" | "questions" | "review" | "saved" | "error";

export default function PromptWizardPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<WizardState>("loading");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [questions, setQuestions] = useState<WizardQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [history, setHistory] = useState<WizardAnswer[]>([]);
  const [emailSummary, setEmailSummary] = useState("");
  const [prompts, setPrompts] = useState<WizardPrompts>({
    email_analyze: "",
    email_actions: "",
  });
  const [saving, setSaving] = useState(false);
  const [round, setRound] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Start the wizard on mount
  const started = useState(() => {
    api
      .startPromptWizard()
      .then((data) => {
        setEmailSummary(data.email_summary);
        setMessage(data.message);
        if (data.done) {
          setPrompts(data.prompts);
          setState("review");
        } else {
          setQuestions(data.questions);
          setRound(1);
          setState("questions");
        }
      })
      .catch((err) => {
        setError(err.message);
        setState("error");
      });
    return true;
  })[0];
  void started;

  const handleAnswerChange = (questionId: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleMultiSelect = (questionId: string, value: string) => {
    setAnswers((prev) => {
      const current = (prev[questionId] as string[]) || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [questionId]: next };
    });
  };

  const handleNext = async () => {
    // Build new history entries from current answers
    const newEntries: WizardAnswer[] = questions.map((q) => {
      const answer = answers[q.id];
      let answerStr: string;
      if (Array.isArray(answer)) {
        answerStr = answer.join(", ");
      } else {
        answerStr = answer || "";
      }
      return {
        question_id: q.id,
        question: q.text,
        answer: answerStr,
      };
    });

    const fullHistory = [...history, ...newEntries];
    setHistory(fullHistory);
    setAnswers({});
    setSubmitting(true);

    try {
      const data = await api.continuePromptWizard({
        email_summary: emailSummary,
        history: fullHistory,
      });

      setMessage(data.message);

      if (data.done) {
        setPrompts(data.prompts);
        setState("review");
      } else {
        setQuestions(data.questions);
        setRound((r) => r + 1);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updatePrompt("email_analyze", prompts.email_analyze);
      await api.updatePrompt("email_actions", prompts.email_actions);
      setState("saved");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
      setState("error");
    } finally {
      setSaving(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        <p className="text-muted-foreground">Analyzing your email patterns...</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Prompt Setup Wizard</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
            <Button className="mt-4" onClick={() => navigate("/prompts")}>
              Back to Prompts
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "saved") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Prompt Setup Wizard</h1>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-green-600 font-medium">
              Prompts saved successfully!
            </p>
            <p className="text-muted-foreground">
              Your AI email assistant is now configured with personalized
              prompts.
            </p>
            <Button onClick={() => navigate("/prompts")}>
              View Prompts
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "review") {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Review Generated Prompts</h1>
        {message && (
          <p className="text-muted-foreground">{message}</p>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              <code>email_analyze</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Textarea
              value={prompts.email_analyze}
              onChange={(e) =>
                setPrompts((p) => ({ ...p, email_analyze: e.target.value }))
              }
              rows={12}
              className="font-mono text-sm"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              <code>email_actions</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Textarea
              value={prompts.email_actions}
              onChange={(e) =>
                setPrompts((p) => ({ ...p, email_actions: e.target.value }))
              }
              rows={12}
              className="font-mono text-sm"
            />
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Prompts"}
          </Button>
          <Button variant="outline" onClick={() => navigate("/prompts")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // state === "questions"
  const allAnswered = questions.every((q) => {
    const answer = answers[q.id];
    if (q.type === "text") return typeof answer === "string" && answer.trim() !== "";
    if (q.type === "multi_select") return Array.isArray(answer) && answer.length > 0;
    return typeof answer === "string" && answer !== "";
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Prompt Setup Wizard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Round {round} of 2-3
        </p>
      </div>

      {message && (
        <p className="text-muted-foreground">{message}</p>
      )}

      <div className="space-y-6">
        {questions.map((q) => (
          <Card key={q.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">{q.text}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {q.type === "text" && (
                <Input
                  value={(answers[q.id] as string) || ""}
                  onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                  placeholder="Type your answer..."
                />
              )}

              {q.type === "single_select" && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <Button
                      key={opt.value}
                      size="sm"
                      variant={
                        answers[q.id] === opt.value ? "default" : "outline"
                      }
                      onClick={() => handleAnswerChange(q.id, opt.value)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              )}

              {q.type === "multi_select" && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => {
                    const selected = (
                      (answers[q.id] as string[]) || []
                    ).includes(opt.value);
                    return (
                      <Button
                        key={opt.value}
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        onClick={() => toggleMultiSelect(q.id, opt.value)}
                      >
                        {selected ? "\u2713 " : ""}
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Button onClick={handleNext} disabled={!allAnswered || submitting}>
          {submitting ? "Processing..." : "Next"}
        </Button>
        <Button variant="outline" onClick={() => navigate("/prompts")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
