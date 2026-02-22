const BASE = "/api/v1";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    window.location.href = "/auth/login";
    throw new Error("Not authenticated");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }

  return res.json() as Promise<T>;
}

export const api = {
  getMe: () => request<{ email: string; user_id: number }>("/auth/me"),

  getLabels: () => request<import("./types").Label[]>("/labels"),
  createLabel: (name: string, description: string) =>
    request<import("./types").Label>("/labels", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  updateLabel: (id: number, name: string, description: string, reasons: string[]) =>
    request<import("./types").Label>(`/labels/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, description, reasons }),
    }),
  deleteLabel: (id: number) =>
    request<{ status: string }>(`/labels/${id}`, { method: "DELETE" }),

  getEmails: (limit = 50) =>
    request<import("./types").Email[]>(`/emails?limit=${limit}`),
  updateFeedback: (id: string, feedback: string) =>
    request<{ status: string }>(`/emails/${id}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ feedback }),
    }),

  getPrompts: () => request<import("./types").PromptsResponse>("/prompts"),
  updatePrompt: (type: string, content: string) =>
    request<{ status: string }>("/prompts", {
      method: "PUT",
      body: JSON.stringify({ type, content }),
    }),
  initDefaults: () =>
    request<{ status: string }>("/prompts/defaults", { method: "POST" }),

  getMemories: (limit = 100) =>
    request<import("./types").Memory[]>(`/memories?limit=${limit}`),
  generateMemory: () =>
    request<{ status: string }>("/memories/generate", { method: "POST" }),
  generateAIPrompts: () =>
    request<{ status: string }>("/memories/generate-ai-prompts", {
      method: "POST",
    }),

  getWrapups: (limit = 30) =>
    request<import("./types").WrapupReport[]>(`/wrapups?limit=${limit}`),
};
