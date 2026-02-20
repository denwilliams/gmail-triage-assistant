import type { SystemPrompt } from '../types'
import { layout, escHtml } from './layout'

export function promptsPage(email: string, prompts: SystemPrompt[]): string {
  const promptsHtml = prompts.length > 0
    ? prompts.map(p => `
      <article>
        <h3>${escHtml(p.type)}</h3>
        ${p.description ? `<p><em>${escHtml(p.description)}</em></p>` : ''}
        <form method="POST" action="/prompts/update">
          <input type="hidden" name="type" value="${escHtml(p.type)}">
          <label>Content<textarea name="content" rows="10">${escHtml(p.content)}</textarea></label>
          <button type="submit">Update</button>
        </form>
      </article>`).join('')
    : `
      <article>
        <p>No prompts configured.</p>
        <a href="/prompts/init" role="button" class="secondary">Initialize Defaults</a>
      </article>`

  const content = `
    <h2>System Prompts</h2>
    <p>Configure the AI prompts used during email processing and memory generation.</p>
    ${promptsHtml}`
  return layout('Prompts', content, { email })
}
