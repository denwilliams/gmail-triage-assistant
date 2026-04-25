// Gmail REST API client using Workers fetch()

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  body: string;
  labelIds: string[];
  internalDate: number;
  inReplyTo: string | null;       // RFC 2822 In-Reply-To header
  messageIdHeader: string | null; // RFC 2822 Message-Id header
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
}

// ---------- helpers ----------

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Decode base64url-encoded data (Gmail body encoding). */
function base64urlDecode(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

/** Encode a string to base64url (UTF-8 safe; Gmail wants base64url for raw). */
function base64urlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Encode a string using RFC 2047 format for email headers with non-ASCII characters. */
function encodeRfc2047(text: string): string {
  // ASCII-safe text doesn't need encoding
  if (/^[\x00-\x7F]*$/.test(text)) return text;
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/**
 * Parse "Name <email@example.com>" -> "email@example.com"
 * Returns lowercased email address; falls back to raw value.
 */
export function parseAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  if (match) {
    return match[1].toLowerCase();
  }
  return raw.toLowerCase();
}

/**
 * Recursively search MIME parts for the first text/plain part with data.
 */
function extractBody(payload: any): string {
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return payload.body.data;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return part.body.data;
      }
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

/** Calculate how many days ago a timestamp (ms) was, minimum 1. */
function daysAgo(timestampMs: number): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const thenSec = Math.floor(timestampMs / 1000);
  const days = Math.floor((nowSec - thenSec) / 86400);
  return days < 1 ? 1 : days;
}

function parseGmailMessage(raw: any): GmailMessage {
  const headers: { name: string; value: string }[] = raw.payload?.headers ?? [];
  let subject = '';
  let from = '';
  let inReplyTo: string | null = null;
  let messageIdHeader: string | null = null;
  for (const h of headers) {
    if (h.name === 'Subject') subject = h.value;
    else if (h.name === 'From') from = parseAddress(h.value);
    else if (h.name === 'In-Reply-To') inReplyTo = h.value.trim();
    else if (h.name === 'Message-ID' || h.name === 'Message-Id') messageIdHeader = h.value.trim();
  }

  const bodyData = extractBody(raw.payload ?? {});
  const body = bodyData ? base64urlDecode(bodyData) : '';

  return {
    id: raw.id,
    threadId: raw.threadId,
    subject,
    from,
    body,
    labelIds: raw.labelIds ?? [],
    internalDate: parseInt(raw.internalDate, 10),
    inReplyTo,
    messageIdHeader,
  };
}

// ---------- public API ----------

/**
 * Fetch messages since a given timestamp (milliseconds).
 * Uses query "in:inbox" with newer_than filter, then filters by exact timestamp.
 */
export async function getMessagesSince(
  accessToken: string,
  since: number,
  maxResults: number,
): Promise<GmailMessage[]> {
  const days = daysAgo(since);
  const query = `in:inbox newer_than:${days}d`;
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });

  const listRes = await fetch(`${GMAIL_BASE}/messages?${params}`, {
    headers: authHeaders(accessToken),
  });
  if (!listRes.ok) {
    throw new Error(`Gmail list error: ${listRes.status} ${await listRes.text()}`);
  }

  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  if (!listData.messages || listData.messages.length === 0) {
    return [];
  }

  const messages: GmailMessage[] = [];
  for (const m of listData.messages) {
    const msg = await getMessage(accessToken, m.id);
    // Filter by exact timestamp (Gmail query is approximate)
    if (msg.internalDate >= since) {
      messages.push(msg);
    }
  }

  return messages;
}

/** Fetch a single message with full format, parsing Subject, From, and body. */
export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=full`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Gmail get message error: ${res.status} ${await res.text()}`);
  }

  const raw = await res.json();
  return parseGmailMessage(raw);
}

/** Add labels to a message. */
export async function addLabels(
  accessToken: string,
  messageId: string,
  labelIds: string[],
): Promise<void> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: labelIds }),
  });
  if (!res.ok) {
    throw new Error(`Gmail add labels error: ${res.status} ${await res.text()}`);
  }
}

/** Archive a message (remove INBOX label). */
export async function archiveMessage(accessToken: string, messageId: string): Promise<void> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
  });
  if (!res.ok) {
    throw new Error(`Gmail archive error: ${res.status} ${await res.text()}`);
  }
}

/** List all labels for the authenticated user. */
export async function listLabels(accessToken: string): Promise<GmailLabel[]> {
  const res = await fetch(`${GMAIL_BASE}/labels`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Gmail list labels error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { labels: GmailLabel[] };
  return data.labels ?? [];
}

/** Find a label ID by exact name. Returns null if not found. */
export async function getLabelId(accessToken: string, labelName: string): Promise<string | null> {
  const labels = await listLabels(accessToken);
  for (const label of labels) {
    if (label.name === labelName) {
      return label.id;
    }
  }
  return null;
}

/** Create a new user label, ensuring parent labels exist for nested paths (e.g., "📥/1d"). */
export async function createLabel(accessToken: string, labelName: string): Promise<GmailLabel> {
  // If the label contains "/", ensure parent exists first so Gmail creates a nested label
  const slashIdx = labelName.lastIndexOf('/');
  if (slashIdx > 0) {
    const parentName = labelName.slice(0, slashIdx);
    const parentId = await getLabelId(accessToken, parentName);
    if (!parentId) {
      await createLabel(accessToken, parentName);
    }
  }

  const res = await fetch(`${GMAIL_BASE}/labels`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: labelName,
      messageListVisibility: 'show',
      labelListVisibility: 'labelShow',
      type: 'user',
    }),
  });
  if (!res.ok) {
    throw new Error(`Gmail create label error: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as GmailLabel;
}

/** Send a plain-text email via the Gmail API. */
export async function sendMessage(
  accessToken: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const raw = `To: ${to}\r\nSubject: ${encodeRfc2047(subject)}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;
  const encoded = base64urlEncode(raw);

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) {
    throw new Error(`Gmail send error: ${res.status} ${await res.text()}`);
  }
}

/**
 * Send a multipart/alternative email (plain + HTML) via Gmail. Returns the
 * Gmail message ID of the sent message.
 */
export async function sendHtmlMessage(
  accessToken: string,
  params: {
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
  },
): Promise<{ id: string }> {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const raw = [
    `To: ${params.to}`,
    `Subject: ${encodeRfc2047(params.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    params.htmlBody,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const encoded = base64urlEncode(raw);

  const res = await fetch(`${GMAIL_BASE}/messages/send`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) {
    throw new Error(`Gmail send error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id };
}

/** Trash a message (move to Gmail trash). */
export async function trashMessage(accessToken: string, messageId: string): Promise<void> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/trash`, {
    method: 'POST',
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Gmail trash error: ${res.status} ${await res.text()}`);
  }
}

/** Remove labels from a message. */
export async function removeLabels(
  accessToken: string,
  messageId: string,
  labelIds: string[],
): Promise<void> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: labelIds }),
  });
  if (!res.ok) {
    throw new Error(`Gmail remove labels error: ${res.status} ${await res.text()}`);
  }
}

/** List message IDs with a specific label. */
export async function listMessagesByLabel(
  accessToken: string,
  labelId: string,
  query?: string,
): Promise<Array<{ id: string }>> {
  let url = `${GMAIL_BASE}/messages?labelIds=${labelId}&maxResults=100`;
  if (query) url += `&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Gmail list by label error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages ?? [];
}

/** Get message metadata (minimal format for date checking). */
export async function getMessageMetadata(
  accessToken: string,
  messageId: string,
): Promise<{ id: string; internalDate: number }> {
  const res = await fetch(`${GMAIL_BASE}/messages/${messageId}?format=minimal`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) {
    throw new Error(`Gmail get metadata error: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string; internalDate: string };
  return { id: data.id, internalDate: parseInt(data.internalDate, 10) };
}

/** Create a draft reply to a message in the same thread. */
export async function createDraft(
  accessToken: string,
  threadId: string,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  // Build RFC 2822 message
  const raw = `To: ${to}\r\nSubject: ${encodeRfc2047(`Re: ${subject}`)}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}`;

  // Base64url encode
  const encoded = base64urlEncode(raw);

  const res = await fetch(`${GMAIL_BASE}/drafts`, {
    method: 'POST',
    headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        threadId,
        raw: encoded,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gmail create draft error: ${res.status} ${await res.text()}`);
  }
}

/** Refresh an OAuth2 access token using a refresh token. */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh error: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as { access_token: string; expires_in: number };
}
