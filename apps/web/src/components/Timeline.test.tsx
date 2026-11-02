import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_BASE } from '@/env'
import type { RunDetail, TimelineEntry } from '@/api/schema'
import { renderWithProviders } from '@/test/render'
import { Timeline } from './Timeline'

const entry: TimelineEntry = { id: 'run_a', at: '2026-10-27T16:02:00-04:00', lane: 'agent', kind: 'run:succeeded', title: 'IVR status check', run_id: 'run_a', evidence_ids: ['ev_ivr'] }
const detail = (evidence: RunDetail['evidence']): RunDetail => ({
  run: { id: 'run_a', agent: 'followup', trigger: 'rule', idempotency_key: 'k', status: 'succeeded', started_at: entry.at, steps: [], action_label: '', result_summary: '', audit_line: '', outcome: '' },
  evidence,
  last_event_id: 3,
})
const ivr = { id: 'ev_ivr', kind: 'ivr_transcript' as const, title: 'Delta IVR', excerpt: 'denied on October 26', captured_at: entry.at, suspicious: false, source: '' }
const url = `${API_BASE}/runs/run_a`

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('Timeline evidence', () => {
  it('fetches nothing until asked, then renders the run’s evidence', async () => {
    let fetched = 0
    server.use(http.get(url, () => {
      fetched++
      return HttpResponse.json(detail([ivr]))
    }))
    renderWithProviders(<Timeline entries={[entry]} />)
    const toggle = await screen.findByRole('button', { name: /1 evidence item/ })
    expect(fetched).toBe(0)
    await userEvent.click(toggle)
    expect(await screen.findByText(/denied on October 26/)).toBeInTheDocument()
    expect(fetched).toBe(1)
  })

  it('offers a retry when the run cannot be loaded', async () => {
    server.use(http.get(url, () => HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })))
    renderWithProviders(<Timeline entries={[entry]} />)
    await userEvent.click(await screen.findByRole('button', { name: /1 evidence item/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the evidence')
    server.use(http.get(url, () => HttpResponse.json(detail([ivr]))))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/denied on October 26/)).toBeInTheDocument()
  })

  it('says so when the run no longer holds the evidence, rather than opening onto nothing', async () => {
    server.use(http.get(url, () => HttpResponse.json(detail([]))))
    renderWithProviders(<Timeline entries={[entry]} />)
    await userEvent.click(await screen.findByRole('button', { name: /1 evidence item/ }))
    expect(await screen.findByText(/holds none of this evidence/)).toBeInTheDocument()
  })
})
