import type { WrapupReport } from '../types'
import { layout, escHtml } from './layout'

const wrapupBorderColor: Record<string, string> = {
  morning: '#f97316',
  evening: '#a855f7',
}

export function wrapupsPage(email: string, reports: WrapupReport[]): string {
  const reportsHtml = reports.length > 0
    ? reports.map(r => {
        const borderColor = wrapupBorderColor[r.report_type] ?? '#6b7280'
        const badgeStyle = r.report_type === 'morning'
          ? 'background:#fef3c7;color:#92400e'
          : 'background:#f3e8ff;color:#6b21a8'
        return `
      <article style="border-left: 4px solid ${borderColor}; padding-left: 1rem;">
        <header>
          <span style="${badgeStyle};padding:2px 8px;border-radius:4px;font-size:0.85em;text-transform:capitalize">${escHtml(r.report_type)}</span>
          <br><small>Generated: ${escHtml(r.generated_at)} &mdash; ${r.email_count} email${r.email_count !== 1 ? 's' : ''}</small>
        </header>
        <pre style="white-space:pre-wrap;font-family:inherit">${escHtml(r.content)}</pre>
      </article>`
      }).join('')
    : '<p><em>No wrapup reports generated yet.</em></p>'

  const content = `
    <h2>Wrapup Reports</h2>
    <p>Daily morning and evening summaries of your email activity.</p>
    ${reportsHtml}`
  return layout('Reports', content, { email })
}
