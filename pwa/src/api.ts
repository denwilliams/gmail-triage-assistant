import type { Bucket, EmailContent, EmailsResponse, RangeId } from './types';

export class AuthError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (res.status === 401) throw new AuthError('Not authenticated');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ email: string; user_id: number }>('/auth/me'),

  emails: (range: RangeId, anchor?: string | null) => {
    const params = new URLSearchParams({ range });
    if (anchor) params.set('anchor', anchor);
    return request<EmailsResponse>(`/m/emails?${params}`);
  },

  content: (id: string) => request<EmailContent>(`/m/emails/${id}/content`),

  reply: (id: string, body: string) =>
    request<{ ok: boolean; to: string }>(`/m/emails/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  archive: (id: string) => request<{ ok: boolean }>(`/m/emails/${id}/archive`, { method: 'POST' }),
  unarchive: (id: string) => request<{ ok: boolean }>(`/m/emails/${id}/unarchive`, { method: 'POST' }),
  trash: (id: string) => request<{ ok: boolean }>(`/m/emails/${id}/trash`, { method: 'POST' }),

  setRead: (id: string, read: boolean) =>
    request<{ ok: boolean }>(`/m/emails/${id}/read`, {
      method: 'POST',
      body: JSON.stringify({ read }),
    }),

  setCollapsed: (id: string, collapsed: boolean) =>
    request<{ ok: boolean }>(`/m/emails/${id}/collapsed`, {
      method: 'POST',
      body: JSON.stringify({ collapsed }),
    }),

  setBucket: (id: string, bucket: Bucket) =>
    request<{ ok: boolean }>(`/m/emails/${id}/bucket`, {
      method: 'POST',
      body: JSON.stringify({ bucket }),
    }),
};

/** Gmail deep link — same scheme the digest uses (thread view preferred). */
export function gmailLink(e: { thread_id: string | null; id: string }): string {
  return `https://mail.google.com/mail/u/0/#all/${e.thread_id || e.id}`;
}
