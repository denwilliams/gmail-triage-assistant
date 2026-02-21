import { describe, it, expect } from 'vitest'
import { buildAnalyzePrompts, buildActionsPrompts } from '../../src/openai/client'

describe('openai prompt builders', () => {
  it('builds analyze prompt with past slugs', () => {
    const { userPrompt } = buildAnalyzePrompts(
      'sender@example.com', 'Your Invoice', 'Please pay...', ['invoice_due'], ''
    )
    expect(userPrompt).toContain('invoice_due')
    expect(userPrompt).toContain('sender@example.com')
  })

  it('injects formatted labels into actions system prompt (default)', () => {
    const { systemPrompt } = buildActionsPrompts(
      'sender@example.com', 'Subject', 'invoice_due', [], 'A summary',
      ['Invoices'], '- "Invoices": for billing', '', ''
    )
    expect(systemPrompt).toContain('Invoices')
  })

  it('appends labels to custom actions prompt', () => {
    const { systemPrompt } = buildActionsPrompts(
      'sender@example.com', 'Subject', 'invoice_due', [], 'A summary',
      ['Invoices'], '- "Invoices": for billing', '', 'Custom prompt here'
    )
    expect(systemPrompt).toContain('Custom prompt here')
    expect(systemPrompt).toContain('Invoices')
  })
})
