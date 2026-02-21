import { layout } from './layout'

export function homePage(): string {
  const content = `
    <article>
      <h1>Gmail Triage Assistant</h1>
      <p>AI-powered email management that automatically categorizes and organizes your Gmail inbox.</p>
      <a href="/auth/login" role="button">Sign in with Google</a>
    </article>`
  return layout('Home', content)
}
