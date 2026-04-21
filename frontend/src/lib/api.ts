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

  getEmails: (
    limit = 50,
    offset = 0,
    filters:
      | import("./types").Bucket
      | {
          bucket?: import("./types").Bucket;
          pipeline_stage?: import("./types").PipelineStage;
          triage_via?: import("./types").TriageVia;
          v2_only?: boolean;
        } = {}
  ) => {
    const f = typeof filters === "string" ? { bucket: filters } : filters;
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (f.bucket) params.set("bucket", f.bucket);
    if (f.pipeline_stage) params.set("pipeline_stage", f.pipeline_stage);
    if (f.triage_via) params.set("triage_via", f.triage_via);
    if (f.v2_only) params.set("v2_only", "1");
    return request<import("./types").Email[]>(`/emails?${params.toString()}`);
  },
  updateFeedback: (id: string, feedback: string) =>
    request<{ status: string }>(`/emails/${id}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ feedback }),
    }),

  getPrompts: () => request<import("./types").PromptsResponse>("/prompts"),
  getDefaultPrompts: () =>
    request<import("./types").DefaultPromptsResponse>("/prompts/defaults"),
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

  getNotifications: (limit = 50) =>
    request<import("./types").Notification[]>(`/notifications?limit=${limit}`),

  getWrapups: (limit = 30) =>
    request<import("./types").WrapupReport[]>(`/wrapups?limit=${limit}`),

  getSenderProfiles: (address: string) =>
    request<import("./types").SenderProfilesResponse>(
      `/sender-profiles?address=${encodeURIComponent(address)}`
    ),
  updateSenderProfile: (
    id: number,
    body: {
      summary?: string;
      sender_type?: string;
      label_counts?: Record<string, number>;
      rating?: number | null;
      rating_reasoning?: string;
      rating_manual?: boolean;
    }
  ) =>
    request<import("./types").SenderProfile>(`/sender-profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  rateSenderNow: (id: number) =>
    request<import("./types").SenderProfile>(`/sender-profiles/${id}/rate`, {
      method: "POST",
    }),
  getAllSenderProfiles: (params: {
    type?: "sender" | "domain";
    search?: string;
    limit?: number;
    offset?: number;
    sort?: import("./types").SenderProfileSort;
    consistency?: import("./types").BucketConsistency;
    bucket?: import("./types").Bucket;
    rating_state?: "null" | "manual" | "auto";
  }): Promise<{ profiles: import("./types").SenderProfile[]; total: number }> => {
    const searchParams = new URLSearchParams();
    if (params.type) searchParams.set("type", params.type);
    if (params.search) searchParams.set("search", params.search);
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.offset) searchParams.set("offset", String(params.offset));
    if (params.sort) searchParams.set("sort", params.sort);
    if (params.consistency) searchParams.set("consistency", params.consistency);
    if (params.bucket) searchParams.set("bucket", params.bucket);
    if (params.rating_state) searchParams.set("rating_state", params.rating_state);
    return request(`/sender-profiles/all?${searchParams.toString()}`);
  },

  generateSenderProfile: (profileType: "sender" | "domain", identifier: string) =>
    request<{ profile: import("./types").SenderProfile; ai_error?: string }>("/sender-profiles/generate", {
      method: "POST",
      body: JSON.stringify({ profile_type: profileType, identifier }),
    }),

  getStatsSummary: () => request<import("./types").DashboardSummary>("/stats/summary"),
  getStatsTimeseries: (days = 30) =>
    request<import("./types").DashboardTimeseries>(`/stats/timeseries?days=${days}`),
  getV2PipelineStats: () =>
    request<import("./types").V2PipelineStats>("/stats/v2-pipeline"),
  getBucketStats: (bucket: import("./types").Bucket) =>
    request<import("./types").BucketStats>(`/stats/bucket/${bucket}`),
  getNewsletterThresholdDistribution: () =>
    request<{ distribution: { score: number; count: number }[] }>(
      "/stats/threshold/newsletter"
    ),
  getHumanRatingThresholdDistribution: () =>
    request<{ distribution: { rating_bucket: string; count: number }[] }>(
      "/stats/threshold/human-rating"
    ),
  getPipelineConfig: () =>
    request<import("./types").PipelineConfig>("/pipeline/config"),
  getPipelineOps: () =>
    request<import("./types").PipelineOps>("/pipeline/ops"),
  retryPipelineEmail: (id: string) =>
    request<{ status: string; bucket: string }>(`/pipeline/retry/${encodeURIComponent(id)}`, {
      method: "POST",
    }),

  startPromptWizard: () =>
    request<import("./types").WizardStartResponse>("/prompt-wizard/start", {
      method: "POST",
    }),
  continuePromptWizard: (body: import("./types").WizardContinueRequest) =>
    request<import("./types").WizardContinueResponse>("/prompt-wizard/continue", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getSettings: () => request<import("./types").UserSettings>("/settings"),
  updateProcessing: (enabled: boolean) =>
    request<{ status: string; processing_enabled: boolean }>("/settings/processing", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  updatePipelineVersion: (version: "v1" | "v2") =>
    request<{ status: string; pipeline_version: string }>("/settings/pipeline-version", {
      method: "PUT",
      body: JSON.stringify({ version }),
    }),
  updateV2Settings: (body: import("./types").V2SettingsUpdate) =>
    request<{
      status: string;
      v2_newsletter_threshold: number;
      v2_human_rating_threshold: number;
      v2_calendar_imminent_minutes: number;
      v2_notify_buckets: Partial<Record<import("./types").Bucket, boolean>>;
    }>("/settings/v2", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  listDigests: (limit = 30) =>
    request<{ digests: import("./types").DailyDigest[] }>(`/digests?limit=${limit}`),
  getDigest: (date: string) =>
    request<{ digest: import("./types").DailyDigest }>(`/digests/${date}`),
  generateDigestNow: () =>
    request<{ status: string }>("/digests/generate", { method: "POST" }),
  updatePushover: (user_key: string, app_token: string) =>
    request<{ status: string }>("/settings/pushover", {
      method: "PUT",
      body: JSON.stringify({ user_key, app_token }),
    }),
  updateWebhook: (url: string, header_key: string, header_value: string) =>
    request<{ status: string }>("/settings/webhook", {
      method: "PUT",
      body: JSON.stringify({ url, header_key, header_value }),
    }),

  exportData: async (includeEmails: boolean) => {
    const res = await fetch(
      `${BASE}/export?include_emails=${includeEmails}`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (res.status === 401) {
      window.location.href = "/auth/login";
      throw new Error("Not authenticated");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || res.statusText);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gmail-triage-export.json";
    a.click();
    URL.revokeObjectURL(url);
  },

  importData: (data: unknown) =>
    request<import("./types").ImportResult>("/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
