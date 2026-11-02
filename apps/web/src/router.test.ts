import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import type { StripSummary } from '@/api/schema'
import { createMockApi } from '@/mocks/node'
import { session } from '@/state/session'
import { createAppRouter, createQueryClient } from './router'

const mock = createMockApi({ stepDelayMs: 0 })
beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  mock.reset()
  session.set({ userId: 'usr_dana', locationId: 'all' })
})
afterAll(() => mock.server.close())

function setup(location: string | undefined) {
  const qc = createQueryClient({ retry: false })
  createAppRouter(qc)
  const cached = { inbox_open: 7 } as StripSummary
  qc.setQueryData(qk.strip(location), cached)
  return { qc, cached }
}

describe('meta.counts on a mutation', () => {
  it('writes the strip under "All locations", where its practice-wide number is right', async () => {
    const { qc } = setup(undefined)
    await api.reject('itm_4733', 'no')
    expect(qc.getQueryData<StripSummary>(qk.strip(undefined))?.inbox_open).toBe(11)
    expect(qc.getQueryState(qk.strip(undefined))?.isInvalidated).toBe(false)
  })

  it('leaves a selected location’s strip to refetch: a practice-wide number does not belong under its key', async () => {
    session.set({ locationId: 'loc_riverside' })
    const { qc, cached } = setup('loc_riverside')
    await api.reject('itm_4733', 'no')
    expect(qc.getQueryData(qk.strip('loc_riverside'))).toBe(cached)
    expect(qc.getQueryState(qk.strip('loc_riverside'))?.isInvalidated).toBe(true)
  })

  it('marks every location’s strip stale when it writes "All locations"', async () => {
    const { qc } = setup(undefined)
    qc.setQueryData(qk.strip('loc_riverside'), { inbox_open: 7 })
    await api.reject('itm_4733', 'no')
    expect(qc.getQueryState(qk.strip('loc_riverside'))?.isInvalidated).toBe(true)
  })

  it('drops the counts of a user who has since been switched away: the strip key has no user in it', async () => {
    const { qc, cached } = setup(undefined)
    const inFlight = api.reject('itm_4733', 'no')
    session.set({ userId: 'usr_morgan' })
    await inFlight
    expect(qc.getQueryData(qk.strip(undefined))).toBe(cached)
  })
})
