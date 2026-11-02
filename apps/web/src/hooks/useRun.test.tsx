import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_BASE } from '@/env'
import { qk } from '@/api/queryKeys'
import type { RunDetail } from '@/api/schema'
import { useRun } from './useRun'

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

const frame = (id: number, event: string, data: unknown) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const counts = {
  tiles: [],
  inbox_open: 10,
  inbox_open_cents: 941700,
  paid_month_count: 118,
  paid_month_cents: 6130000,
  open_count: 107,
  open_cents: 7871000,
  ar_count: 101,
  ar_cents: 7550000,
  flagged_count: 7,
  flagged_cents: 798500,
  as_of: '2026-10-28T10:40:00-04:00',
  paid_month_label: 'Oct',
  nav_badges: { payments: 3, eligibility: 3, activity: 41 },
}

/** The API's end of a run: terminal `status`, then `counts`, then `done`, as separate writes. */
const ending = [
  frame(12, 'status', { run_id: 'run_t', agent: 'followup', status: 'succeeded', claim_id: 'clm_4744', planner: 'recorded_plan' }),
  frame(13, 'counts', counts) + frame(14, 'done', { status: 'succeeded', audit_line: 'audit', result_summary: 'summary' }),
]

const server = setupServer(
  http.get(`${API_BASE}/runs/run_t`, () => HttpResponse.json(snapshot)),
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
  it('reads to `done` past a terminal status frame, so counts land and everything the run changed is refetched', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(qk.strip(undefined), { ...counts, inbox_open: 9 })
    qc.setQueryData(qk.inbox.all, [])
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>

    const { result } = renderHook(() => useRun('run_t'), { wrapper })

    await waitFor(() => expect(result.current.run?.status).toBe('succeeded'))
    await waitFor(() => expect(qc.getQueryData(qk.strip(undefined))).toMatchObject({ inbox_open: 10 }))
    await waitFor(() => expect(qc.getQueryState(qk.inbox.all)?.isInvalidated).toBe(true))
  })
})
