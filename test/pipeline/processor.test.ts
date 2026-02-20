import { describe, it, expect } from 'vitest'
import { buildMemoryContext } from '../../src/pipeline/processor'
import type { Memory } from '../../src/types'

describe('pipeline', () => {
  it('builds empty memory context when no memories', () => {
    const ctx = buildMemoryContext([])
    expect(ctx).toBe('')
  })

  it('builds memory context string from memories', () => {
    const memories: Memory[] = [{
      id: 1, user_id: 1, type: 'daily', content: 'some insight',
      start_date: '2025-01-01', end_date: '2025-01-02', created_at: '2025-01-02'
    }]
    const ctx = buildMemoryContext(memories)
    expect(ctx).toContain('DAILY')
    expect(ctx).toContain('some insight')
  })
})
