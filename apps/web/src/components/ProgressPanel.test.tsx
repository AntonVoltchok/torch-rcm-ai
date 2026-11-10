import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_BASE } from '@/env'
import type { RunDetail } from '@/api/schema'
import { renderWithProviders } from '@/test/render'
import { ProgressPanel } from './ProgressPanel'
import type { Launch } from '@/state/launches'

// GET /runs/{id} answers RunDetail {run, evidence, last_event_id}, as the API does.
const snapshot: RunDetail = {
  run: {
  id: 'run_t',
  agent: 'followup',
  trigger: 'approval',
  claim_id: 'clm_4821',
  inbox_item_id: 'itm_4821',
  idempotency_key: 'approve:itm_4821',
  status: 'queued',
  planner: 'scripted',
  started_at: '2026-10-28T10:40:00-04:00',
  steps: [
    { idx: 0, name: 'fetch_pa_from_pms_imaging', label: '', status: 'pending', tool: '', input_summary: '', output_summary: '', progress_lines: [], evidence_ids: [] },
    { idx: 1, name: 'upload_to_nea', label: '', status: 'pending', tool: '', input_summary: '', output_summary: '', progress_lines: [], evidence_ids: [] },
  ],
  action_label: '',
  result_summary: '',
  audit_line: '',
  outcome: '',
  },
  evidence: [],
  last_event_id: 0,
}

const frame = (id: number, event: string, data: unknown) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const nea = [{ id: 'ev_nea', kind: 'nea_attachment', title: 'PA #30 uploaded' }]

// Deliberately out of order: step 0 completes before its `started` arrives; a replayed duplicate follows.
const events = [
  frame(3, 'step', { idx: 0, name: 'fetch_pa_from_pms_imaging', phase: 'completed', status: 'ok', output_summary: 'PA #30 · PMS imaging' }),
  frame(1, 'step', { idx: 0, name: 'fetch_pa_from_pms_imaging', phase: 'started', status: 'running' }),
  frame(5, 'step', { idx: 1, name: 'upload_to_nea', phase: 'completed', status: 'ok', output_summary: 'NEA# 47731888', evidence: nea }),
  frame(4, 'step', { idx: 1, name: 'upload_to_nea', phase: 'started', status: 'running' }),
  frame(5, 'step', { idx: 1, name: 'upload_to_nea', phase: 'completed', status: 'ok', output_summary: 'NEA# 47731888', evidence: nea }),
  frame(6, 'done', { status: 'succeeded', audit_line: 'Resubmitted #4821 with PA #30 (NEA# 47731888)' }),
]

let lastEventIdSeen: string | null = 'unset'
const server = setupServer(
  http.get(`${API_BASE}/runs/run_t`, () => HttpResponse.json(snapshot)),
  http.get(`${API_BASE}/runs/run_t/events`, ({ request }) => {
    lastEventIdSeen = request.headers.get('Last-Event-ID')
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // Split one frame across chunks to exercise the parser.
        const all = events.join('')
        c.enqueue(enc.encode(all.slice(0, 40)))
        c.enqueue(enc.encode(all.slice(40)))
        c.close()
      },
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const launch: Launch = {
  id: 'run_t',
  kind: 'approve',
  title: 'Approve #4821',
  runs: [{ run_id: 'run_t', claim_id: 'clm_4821', item_id: 'itm_4821', label: '#4821 K. Owens' }],
  started_at: '2026-10-28T10:40:00-04:00',
}

describe('ProgressPanel', () => {
  it('folds out-of-order and duplicate SSE events into a monotonic view', async () => {
    renderWithProviders(<ProgressPanel launch={launch} />)
    const panel = await screen.findByRole('region', { name: 'Agent progress' })
    await waitFor(() => expect(within(panel).getByTestId('audit-line')).toHaveTextContent('NEA# 47731888'))
    const steps = panel.querySelectorAll('[data-step]')
    expect([...steps].map((s) => s.getAttribute('data-status'))).toEqual(['ok', 'ok'])
    expect(within(panel).getByText('PA #30 · PMS imaging')).toBeInTheDocument()
    expect(within(panel).getAllByText('NEA# 47731888').length).toBeGreaterThan(0)
    expect(within(panel).getByText('Open claim #4821 →')).toHaveAttribute('href', '/claims/clm_4821?from=inbox%3Aitm_4821')
    expect(lastEventIdSeen).toBe('0') // resubscribed from the snapshot's cursor
  })

  // ADR-0013: a run the model planned is a recording when the server replays cassettes, and is never called a live call.
  const status = (replay: boolean) => ({ paused: false, paused_by: null, paused_at: null, mode: 'live', replay, live_agents: ['followup'], agents: 5, running: 0, queued: 0, paused_runs: 0 })
  for (const [replay, label] of [[true, 'Claude, recorded API response replayed'], [false, 'Claude, live call']] as const) {
    it(`labels a model-planned run “${label}” when replay is ${String(replay)}`, async () => {
      server.use(
        http.get(`${API_BASE}/runs/run_t`, () => HttpResponse.json({ ...snapshot, run: { ...snapshot.run, planner: 'live' } })),
        http.get(`${API_BASE}/agents/status`, () => HttpResponse.json(status(replay))),
      )
      renderWithProviders(<ProgressPanel launch={launch} />)
      const panel = await screen.findByRole('region', { name: 'Agent progress' })
      await waitFor(() => expect(within(panel).getByTestId('run-planner')).toHaveTextContent(label))
    })
  }
})
