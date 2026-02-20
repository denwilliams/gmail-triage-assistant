import type { Label } from '../types'
import { layout, escHtml } from './layout'

export function labelsPage(email: string, labels: Label[]): string {
  const labelsHtml = labels.length > 0
    ? labels.map(l => `
      <tr>
        <td><strong>${escHtml(l.name)}</strong></td>
        <td>${escHtml(l.description)}</td>
        <td>
          <form method="POST" action="/labels/${l.id}/delete" style="margin:0">
            <button type="submit" class="secondary" onclick="return confirm('Delete this label?')">Delete</button>
          </form>
        </td>
      </tr>`).join('')
    : '<tr><td colspan="3"><em>No labels configured yet</em></td></tr>'

  const content = `
    <article>
      <h2>Label Management</h2>
      <p>Configure labels that the AI can apply to your emails.</p>
      <h3>Create New Label</h3>
      <form method="POST" action="/labels/create">
        <label>Label Name<input type="text" name="name" placeholder="e.g., Work, Personal, Newsletter" required></label>
        <label>Description (helps AI understand when to use this label)<textarea name="description" rows="3"></textarea></label>
        <button type="submit">Create Label</button>
      </form>
    </article>
    <article>
      <h3>Your Labels</h3>
      <table>
        <thead><tr><th>Name</th><th>Description</th><th>Actions</th></tr></thead>
        <tbody>${labelsHtml}</tbody>
      </table>
    </article>`
  return layout('Labels', content, { email })
}
