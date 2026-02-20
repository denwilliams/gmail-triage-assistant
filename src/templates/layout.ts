export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function layout(title: string, content: string, nav?: { email: string }): string {
  const navHtml = nav ? `
    <nav>
      <ul>
        <li><a href="/dashboard"><strong>Gmail Triage</strong></a></li>
      </ul>
      <ul>
        <li><a href="/labels">Labels</a></li>
        <li><a href="/history">History</a></li>
        <li><a href="/prompts">Prompts</a></li>
        <li><a href="/memories">Memories</a></li>
        <li><a href="/wrapups">Reports</a></li>
        <li><small>${escHtml(nav.email)}</small></li>
        <li><a href="/auth/logout" role="button" class="secondary">Logout</a></li>
      </ul>
    </nav>` : ''

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} - Gmail Triage</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body>
  <header class="container">${navHtml}</header>
  <main class="container">${content}</main>
</body>
</html>`
}
