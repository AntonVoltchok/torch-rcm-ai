import { describe, expect, it } from 'vitest'
import type { Run } from '@/api/schema'
import { applyDoneEvent, applyStatusEvent, applyStepEvent, mergeSnapshot } from './runEvents'

const base = (): Run => ({
  id: 'run_1',
  agent: 'followup',
  trigger: 'approval',
  status: 'queued',
  steps: [
    { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'pending', progress_lines: [], evidence_ids: [] },
    { idx: 1, name: 'upload_to_nea', status: 'pending', progress_lines: [], evidence_ids: [] },
  ],
  evidence: [],
  last_event_id: null,
})

const nea = { id: 'ev_nea', kind: 'nea_attachment' as const, title: 'PA uploaded', excerpt: 'NEA# 47731888', captured_at: '2026-10-28T10:40:00-04:00', reference: '47731888' }

describe('run event reducer', () => {
  it('applies events in order', () => {
    let r = applyStepEvent(base(), { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'running', phase: 'started' }, 1)
    r = applyStepEvent(r, { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'ok', phase: 'completed', output_summary: 'PA #30' }, 2)
    expect(r.status).toBe('running')
    expect(r.steps[0]).toMatchObject({ status: 'ok', output_summary: 'PA #30' })
    expect(r.last_event_id).toBe(2)
  })

  it('never moves a step backwards when a late `started` arrives after `completed`', () => {
    let r = applyStepEvent(base(), { idx: 1, name: 'upload_to_nea', status: 'ok', output_summary: 'NEA# 47731888', evidence: nea }, 5)
    r = applyStepEvent(r, { idx: 1, name: 'upload_to_nea', status: 'running', output_summary: 'uploading…' }, 4)
    expect(r.steps[1]).toMatchObject({ status: 'ok', output_summary: 'NEA# 47731888', evidence_ids: ['ev_nea'] })
    expect(r.last_event_id).toBe(5)
  })

  it('is idempotent under replay (same event twice)', () => {
    const ev = { idx: 1, name: 'upload_to_nea', status: 'ok' as const, evidence: nea, progress_line: 'read PMS imaging' }
    const once = applyStepEvent(base(), ev, 3)
    const twice = applyStepEvent(once, ev, 3)
    expect(twice).toEqual(once)
    expect(twice.evidence).toHaveLength(1)
    expect(twice.steps[1]?.progress_lines).toEqual(['read PMS imaging'])
  })

  it('accepts a step it has not seen yet and keeps steps ordered', () => {
    const r = applyStepEvent(base(), { idx: 3, name: 'report', status: 'running' }, 9)
    expect(r.steps.map((s) => s.idx)).toEqual([0, 1, 3])
  })

  it('lets paused ⇄ running flip but nothing leaves a terminal state', () => {
    let r = applyStatusEvent(base(), { status: 'running' }, 1)
    r = applyStatusEvent(r, { status: 'paused' }, 2)
    expect(r.status).toBe('paused')
    r = applyStatusEvent(r, { status: 'running' }, 3)
    r = applyDoneEvent(r, { status: 'succeeded', audit_line: 'Resubmitted #4821' }, 4)
    r = applyStatusEvent(r, { status: 'running' }, 2)
    expect(r.status).toBe('succeeded')
    expect(r.audit_line).toBe('Resubmitted #4821')
  })

  it('merges a stale snapshot with what SSE already delivered', () => {
    const live = applyStepEvent(applyStepEvent(base(), { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'ok' }, 2), { idx: 1, name: 'upload_to_nea', status: 'running' }, 3)
    const merged = mergeSnapshot(live, { ...base(), status: 'running', last_event_id: 1 })
    expect(merged.steps.map((s) => s.status)).toEqual(['ok', 'running'])
    expect(merged.last_event_id).toBe(3)
  })
})
