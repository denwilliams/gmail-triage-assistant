import type { Memory, MemoryType } from '../types'
import { layout, escHtml } from './layout'

const memoryBorderColor: Record<MemoryType, string> = {
  daily: '#3b82f6',
  weekly: '#22c55e',
  monthly: '#f97316',
  yearly: '#a855f7',
}

export function memoriesPage(email: string, memories: Memory[]): string {
  const memoriesHtml = memories.length > 0
    ? memories.map(m => {
        const borderColor = memoryBorderColor[m.type] ?? '#6b7280'
        return `
      <article style="border-left: 4px solid ${borderColor}; padding-left: 1rem;">
        <header>
          <strong style="text-transform:capitalize">${escHtml(m.type)}</strong>
          <br><small>${escHtml(m.start_date)} &mdash; ${escHtml(m.end_date)}</small>
        </header>
        <p style="white-space:pre-wrap">${escHtml(m.content)}</p>
        <footer><small>Generated: ${escHtml(m.created_at)}</small></footer>
      </article>`
      }).join('')
    : '<p><em>No memories generated yet.</em></p>'

  const content = `
    <header style="display:flex;justify-content:space-between;align-items:center">
      <h2>Memory Bank</h2>
      <form method="POST" action="/memories/generate" style="margin:0">
        <button type="submit">Generate Daily Memory</button>
      </form>
    </header>
    <p>AI-generated insights from your email patterns over time.</p>
    ${memoriesHtml}`
  return layout('Memories', content, { email })
}
