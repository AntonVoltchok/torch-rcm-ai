import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { qk } from '@/api/queryKeys'
import { settle } from './useInboxActions'

describe('settle after an Inbox decision', () => {
  it('refetches the rules table (its `waiting` counts) and the Denials worklist, not only the Inbox', () => {
    const qc = new QueryClient()
    for (const key of [qk.inbox.all, qk.rules, qk.ruleChanges, qk.denials, qk.claim('clm_4821')]) qc.setQueryData(key, {})
    settle(qc, ['clm_4821'])
    for (const key of [qk.inbox.all, qk.rules, qk.ruleChanges, qk.denials, qk.claim('clm_4821')]) {
      expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true)
    }
  })
})
