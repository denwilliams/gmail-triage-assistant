import { layout } from './layout'

export function dashboardPage(email: string): string {
  const content = `
    <article>
      <h2>Dashboard</h2>
      <p>Welcome! Your Gmail inbox is now being monitored.</p>
      <p>Email processing will begin shortly...</p>
    </article>`
  return layout('Dashboard', content, { email })
}
