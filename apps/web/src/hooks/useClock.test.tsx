import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_BASE } from '@/env'
import { launchStore } from '@/state/launches'
import { useToasts } from '@/state/toast'
import { useResetDemo } from './useClock'

const counts = {
  tiles: [],
  moves: [],
  inbox_open: 12,
  inbox_open_cents: 0,
  inbox_claims: 0,
  inbox_visits: 0,
  paid_month_count: 118,
  paid_month_cents: 0,
  open_count: 107,
  open_cents: 0,
  ar_count: 101,
  ar_cents: 0,
  flagged_count: 9,
  flagged_cents: 0,
  as_of: '2026-10-28T10:40:00-04:00',
  paid_month_label: 'Oct',
  nav_badges: { payments: 3, eligibility: 3, activity: 41 },
}

const server = setupServer(
  http.post(`${API_BASE}/clock/reset`, () =>
    HttpResponse.json({ scenario: 'canonical', now: '2026-10-28T10:40:00-04:00', meta: { counts } }),
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  launchStore.clear()
})
afterAll(() => server.close())

describe('useResetDemo', () => {
  it('forgets the runs started before the reset: they no longer exist, so they would read "running" forever', async () => {
    launchStore.add({
      id: 'run_old',
      kind: 'approve_group',
      title: 'Approve 3',
      runs: [{ run_id: 'run_old', claim_id: 'clm_4821', item_id: 'itm_4821', label: '#4821 K. Owens' }],
      started_at: '2026-10-28T10:40:00-04:00',
    })
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useResetDemo(), { wrapper })

    await act(() => result.current.mutateAsync())

    expect(launchStore.get()).toEqual([])
  })

  it('says why when the API refuses: a run is finishing, and the launches stay', async () => {
    server.use(
      http.post(`${API_BASE}/clock/reset`, () =>
        HttpResponse.json({ error: { code: 'run_in_progress', message: 'An agent run is finishing. Reset when it is done.' } }, { status: 409 }),
      ),
    )
    launchStore.add({
      id: 'run_live',
      kind: 'approve',
      title: 'Approve',
      runs: [{ run_id: 'run_live', claim_id: 'clm_4821', item_id: 'itm_4821', label: '#4821 K. Owens' }],
      started_at: '2026-10-28T10:40:00-04:00',
    })
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result } = renderHook(() => ({ reset: useResetDemo(), toasts: useToasts() }), { wrapper })

    await act(async () => {
      await result.current.reset.mutateAsync().catch(() => undefined)
    })

    expect(launchStore.get()).toHaveLength(1)
    expect(result.current.toasts.at(-1)?.message).toContain('Reset when it is done')
  })
})
