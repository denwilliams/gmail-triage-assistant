import type { Email } from '../types'
import { layout, escHtml } from './layout'

export function historyPage(email: string, emails: Email[]): string {
  const emailsHtml = emails.length > 0
    ? emails.map(e => {
        const keywordsHtml = e.keywords.length > 0
          ? e.keywords.map(k => `<code>${escHtml(k)}</code>`).join(' ')
          : '<em>none</em>'

        const labelsHtml = e.labels_applied.length > 0
          ? e.labels_applied.map(l => `<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:4px;margin-right:4px;font-size:0.85em">${escHtml(l)}</span>`).join('')
          : '<em>none</em>'

        const archivedBadge = e.bypassed_inbox
          ? ' <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:0.85em">Archived</span>'
          : ''

        const feedbackHtml = e.human_feedback
          ? `<p><strong>Your feedback:</strong> ${escHtml(e.human_feedback)}</p>`
          : ''

        return `
      <article>
        <header>
          <strong>${escHtml(e.subject)}</strong>${archivedBadge}
          <br><small>From: ${escHtml(e.from_address)} &mdash; ${escHtml(e.processed_at)}</small>
        </header>
        <p><strong>Slug:</strong> <code>${escHtml(e.slug)}</code></p>
        <p><strong>Summary:</strong> ${escHtml(e.summary)}</p>
        <p><strong>Keywords:</strong> ${keywordsHtml}</p>
        <p><strong>Labels applied:</strong> ${labelsHtml}</p>
        <p><strong>AI reasoning:</strong> ${escHtml(e.reasoning)}</p>
        ${feedbackHtml}
        <details>
          <summary>Submit feedback</summary>
          <form method="POST" action="/history/feedback">
            <input type="hidden" name="email_id" value="${escHtml(e.id)}">
            <label>Your feedback<textarea name="feedback" rows="3" placeholder="Tell the AI what it did right or wrong...">${escHtml(e.human_feedback)}</textarea></label>
            <button type="submit">Save Feedback</button>
          </form>
        </details>
      </article>`
      }).join('')
    : '<p><em>No emails processed yet.</em></p>'

  const content = `
    <h2>Email Processing History</h2>
    ${emailsHtml}`
  return layout('History', content, { email })
}
