// Webhook notification client using Workers fetch()

export interface WebhookPayload {
  title: string;
  message: string;
  from_address: string;
  email_id: string;
  slug: string;
  subject: string;
  labels_applied: string[];
  processed_at: string;
}

/**
 * Send a webhook notification.
 * Validates URL scheme, adds optional custom header, enforces 10s timeout.
 */
export async function sendWebhook(
  url: string,
  headerKey: string,
  headerValue: string,
  payload: WebhookPayload,
): Promise<void> {
  // Validate URL scheme
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Webhook URL must use http or https scheme, got "${parsed.protocol}"`);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (headerKey) {
    headers[headerKey] = headerValue;
  }

  // 10-second timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Webhook returned status ${res.status}`);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
