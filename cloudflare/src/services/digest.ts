// ============================================================================
// Daily digest composer
// ----------------------------------------------------------------------------
// Given the three buckets of items (interesting newsletters, low-priority
// notifications, quiet-human senders) this module produces HTML + plain-text
// bodies suitable for sendHtmlMessage.
// ============================================================================

import type {
  DigestItemCounts,
  DigestNewsletterItem,
  DigestNotificationItem,
  DigestQuietHumanItem,
  DigestSections,
} from '../types/models';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${threadId}`;
}

function gmailMessageUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

function linkToEmail(emailId: string, threadId?: string | null): string {
  return threadId ? gmailThreadUrl(threadId) : gmailMessageUrl(emailId);
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function newsletterHtml(items: DigestNewsletterItem[]): string {
  if (items.length === 0) return '';
  const rows = items.map((item) => {
    const reasons = item.reasons.length
      ? `<ul style="margin:4px 0 0 18px;padding:0;">${item.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '';
    return `<li style="margin:0 0 14px 0;">
  <a href="${esc(linkToEmail(item.emailId))}" style="color:#1a73e8;text-decoration:none;font-weight:600;">${esc(item.subject || '(no subject)')}</a>
  <div style="color:#5f6368;font-size:13px;margin-top:2px;">${esc(item.fromAddress)} · score ${item.interestingScore}/10</div>
  <div style="margin-top:4px;">${esc(item.summary)}</div>
  ${reasons}
</li>`;
  }).join('');
  return `
<section style="margin-bottom:28px;">
  <h2 style="font-size:18px;margin:0 0 12px 0;">📚 Newsletters worth your time</h2>
  <ul style="list-style:disc;margin:0;padding-left:20px;">${rows}</ul>
</section>`;
}

function notificationHtml(items: DigestNotificationItem[]): string {
  if (items.length === 0) return '';
  const rows = items.map((item) => `<li style="margin:0 0 10px 0;">
  <a href="${esc(linkToEmail(item.emailId))}" style="color:#1a73e8;text-decoration:none;font-weight:600;">${esc(item.subject || '(no subject)')}</a>
  <div style="color:#5f6368;font-size:13px;margin-top:2px;">${esc(item.fromAddress)} · severity ${esc(item.severity)} · urgency ${esc(item.urgency)}</div>
  <div style="margin-top:4px;">${esc(item.summary)}</div>
</li>`).join('');
  return `
<section style="margin-bottom:28px;">
  <h2 style="font-size:18px;margin:0 0 12px 0;">🔔 Notifications summary</h2>
  <ul style="list-style:disc;margin:0;padding-left:20px;">${rows}</ul>
</section>`;
}

function quietHumansHtml(items: DigestQuietHumanItem[]): string {
  if (items.length === 0) return '';
  const rows = items.map((item) => `<li style="margin:0 0 10px 0;">
  <a href="${esc(linkToEmail(item.emailId))}" style="color:#1a73e8;text-decoration:none;font-weight:600;">${esc(item.subject || '(no subject)')}</a>
  <div style="color:#5f6368;font-size:13px;margin-top:2px;">${esc(item.fromAddress)} · rating ${item.rating}/100</div>
  <div style="margin-top:4px;">${esc(item.summary)}</div>
  ${item.ratingReasoning ? `<div style="color:#5f6368;font-size:12px;margin-top:2px;font-style:italic;">Rating: ${esc(item.ratingReasoning)}</div>` : ''}
</li>`).join('');
  return `
<section style="margin-bottom:28px;">
  <h2 style="font-size:18px;margin:0 0 12px 0;">💬 Quiet humans</h2>
  <p style="color:#5f6368;font-size:13px;margin:0 0 10px 0;">Low-rated senders whose emails were auto-archived. Check the rating if any of these look misgraded.</p>
  <ul style="list-style:disc;margin:0;padding-left:20px;">${rows}</ul>
</section>`;
}

// ---------------------------------------------------------------------------
// Plain text variants
// ---------------------------------------------------------------------------

function newsletterText(items: DigestNewsletterItem[]): string {
  if (items.length === 0) return '';
  return '📚 Newsletters worth your time\n' + items.map((item) =>
    `  - ${item.subject || '(no subject)'}\n` +
    `    from ${item.fromAddress} · score ${item.interestingScore}/10\n` +
    `    ${item.summary}\n` +
    (item.reasons.length ? '    ' + item.reasons.map((r) => `• ${r}`).join('\n    ') + '\n' : '') +
    `    ${linkToEmail(item.emailId)}\n`,
  ).join('\n') + '\n';
}

function notificationText(items: DigestNotificationItem[]): string {
  if (items.length === 0) return '';
  return '🔔 Notifications summary\n' + items.map((item) =>
    `  - ${item.subject || '(no subject)'}\n` +
    `    from ${item.fromAddress} · ${item.severity}/${item.urgency}\n` +
    `    ${item.summary}\n` +
    `    ${linkToEmail(item.emailId)}\n`,
  ).join('\n') + '\n';
}

function quietHumansText(items: DigestQuietHumanItem[]): string {
  if (items.length === 0) return '';
  return '💬 Quiet humans\n' + items.map((item) =>
    `  - ${item.subject || '(no subject)'}\n` +
    `    from ${item.fromAddress} · rating ${item.rating}/100\n` +
    `    ${item.summary}\n` +
    `    ${linkToEmail(item.emailId)}\n`,
  ).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Public composer
// ---------------------------------------------------------------------------

export interface ComposedDigest {
  html: string;
  text: string;
  itemCounts: DigestItemCounts;
}

export function composeDigest(params: {
  digestDate: string;
  intro: string;
  sections: DigestSections;
}): ComposedDigest {
  const counts: DigestItemCounts = {
    newsletters: params.sections.newsletters.length,
    notifications: params.sections.notifications.length,
    quietHumans: params.sections.quietHumans.length,
  };

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#202124;margin:0;padding:24px;max-width:680px;">
  <h1 style="font-size:22px;margin:0 0 4px 0;">Gmail Triage — Daily digest</h1>
  <div style="color:#5f6368;font-size:13px;margin-bottom:20px;">${esc(params.digestDate)}</div>
  <p style="margin:0 0 24px 0;">${esc(params.intro)}</p>
  ${newsletterHtml(params.sections.newsletters)}
  ${notificationHtml(params.sections.notifications)}
  ${quietHumansHtml(params.sections.quietHumans)}
  <hr style="border:none;border-top:1px solid #e8eaed;margin:24px 0;">
  <p style="color:#5f6368;font-size:12px;margin:0;">Sent by your Gmail Triage Assistant. Adjust sender ratings in the web UI if something's been misgraded.</p>
</body></html>`;

  const text = [
    `Gmail Triage — Daily digest (${params.digestDate})`,
    '',
    params.intro,
    '',
    newsletterText(params.sections.newsletters),
    notificationText(params.sections.notifications),
    quietHumansText(params.sections.quietHumans),
    '---',
    'Sent by your Gmail Triage Assistant.',
  ].filter(Boolean).join('\n');

  return { html, text, itemCounts: counts };
}
