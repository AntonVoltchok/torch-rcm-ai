import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_BASE } from '@/env'
import { qk } from '@/api/queryKeys'
import type { RunDetail } from '@/api/schema'
import { useRun } from './useRun'
import { useStrip } from './useStrip'

const snapshot: RunDetail = {
  run: {
    id: 'run_t',
    agent: 'followup',
    trigger: 'manual',
    claim_id: 'clm_4744',
    idempotency_key: 'triage:clm_4744',
    status: 'running',
    planner: 'recorded_plan',
    started_at: '2026-10-28T10:40:00-04:00',
    steps: [],
    action_label: '',
    result_summary: '',
    audit_line: '',
    outcome: '',
  },
  evidence: [],
  last_event_id: 0,
}

const frame = (id: number | null, event: string, data: unknown) => `${id === null ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const counts = {
  tiles: [],
  moves: [],
  inbox_open: 10,
  inbox_open_cents: 941700,
  inbox_claims: 0,
  inbox_visits: 0,
  inbox_waiting: [],
  paid_month_count: 118,
  paid_month_cents: 6130000,
  open_count: 107,
  open_cents: 7871000,
  ar_count: 101,
  ar_cents: 7550000,
  flagged_count: 7,
  flagged_cents: 798500,
  all_count: 225,
  as_of: '2026-10-28T10:40:00-04:00',
  paid_month_label: 'Oct',
  nav_badges: { payments: 3, eligibility: 3, activity: 41 },
}

/**
 * The API's end of a run, as separate writes: terminal `status`, then `counts` and the real `done` from the run's log, then
 * what the route appends once it sees the run terminal, with no ids. The `counts` frame has no viewer and no location, so
 * its number must never reach the strip: it differs here from what GET /summary/strip answers.
 */
const ending = [
  frame(12, 'status', { run_id: 'run_t', agent: 'followup', status: 'succeeded', claim_id: 'clm_4744', planner: 'recorded_plan' }),
  frame(13, 'counts', { ...counts, inbox_open: 99 }) +
    frame(14, 'done', {
      run_id: 'run_t',
      status: 'succeeded',
      outcome: 'Done',
      result_summary: 'summary',
      audit_line: 'audit',
      planner: 'recorded_plan',
      model_situation_label: null,
    }),
  frame(null, 'status', { status: 'succeeded' }) + frame(null, 'done', { run_id: 'run_t' }),
]

const server = setupServer(
  http.get(`${API_BASE}/runs/run_t`, () => HttpResponse.json(snapshot)),
  http.get(`${API_BASE}/summary/strip`, () => HttpResponse.json(counts)),
  http.get(`${API_BASE}/runs/run_t/events`, ({ request }) => {
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        c.enqueue(enc.encode(ending[0]))
        // Long enough for React to render the terminal status before the rest arrives.
        await new Promise((r) => setTimeout(r, 40))
        // A browser stops delivering the moment the client aborts; msw in Node would keep going.
        if (request.signal.aborted) {
          c.close()
          return
        }
        c.enqueue(enc.encode(ending[1]))
        await new Promise((r) => setTimeout(r, 5))
        c.enqueue(enc.encode(ending[2]))
        c.close()
      },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('useRun', () => {
  it('reads to the first `done` past a terminal status frame, then refreshes everything the run changed exactly once', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(qk.strip(undefined), { ...counts, inbox_open: 9 })
    qc.setQueryData(qk.inbox.all, [])
    const invalidated = vi.spyOn(qc, 'invalidateQueries')
    const times = (key: readonly unknown[]) => invalidated.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(key)).length
    const written = vi.spyOn(qc, 'setQueryData')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(() => ({ run: useRun('run_t'), strip: useStrip() }), { wrapper })

    await waitFor(() => expect(result.current.run.run?.status).toBe('succeeded'))
    await waitFor(() => expect(result.current.strip.data?.inbox_open).toBe(9)) // refetched for this viewer
    expect(written.mock.calls.filter(([key]) => key[0] === 'strip')).toEqual([]) // never written from the frame
    await waitFor(() => expect(result.current.run.mode).toBe('idle')) // a clean end: the trailing bare `done` is not a desync
    expect(qc.getQueryState(qk.inbox.all)?.isInvalidated).toBe(true)
    for (const key of [qk.run('run_t'), qk.stripAll, qk.inbox.all, qk.claims.all, qk.claim('clm_4744')]) expect(times(key)).toBe(1)
  })
})
