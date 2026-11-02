import { describe, expect, it } from 'vitest'
import type { Evidence, RunView, RunViewStep } from '@/api/schema'
import { applyDoneEvent, applyStatusEvent, applyStepEvent, mergeSnapshot, reduceRunMessage, runViewOf } from './runEvents'

const step = (idx: number, name: string): RunViewStep => ({ idx, name, label: '', status: 'pending', tool: '', input_summary: '', output_summary: '', progress_lines: [], evidence_ids: [] })

const base = (): RunView => ({
  id: 'run_1',
  agent: 'followup',
  trigger: 'approval',
  idempotency_key: 'approve:run_1',
  status: 'queued',
  started_at: '2026-10-28T10:40:00-04:00',
  steps: [step(0, 'fetch_pa_from_pms_imaging'), step(1, 'upload_to_nea')],
  action_label: '',
  result_summary: '',
  audit_line: '',
  outcome: '',
  evidence: [],
  last_event_id: null,
})

const nea: Evidence = { id: 'ev_nea', kind: 'nea_attachment', title: 'PA uploaded', excerpt: 'NEA# 47731888', captured_at: '2026-10-28T10:40:00-04:00', reference: '47731888', suspicious: false, source: '' }
/** What `event: step` carries (`agents/runtime.py`): references, hydrated by the next GET /runs/{id}. */
const neaRef = { id: nea.id, kind: nea.kind, title: nea.title }

describe('run event reducer', () => {
  it('applies events in order', () => {
    let r = applyStepEvent(base(), { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'running', phase: 'started' }, 1)
    r = applyStepEvent(r, { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'ok', phase: 'completed', output_summary: 'PA #30' }, 2)
    expect(r.status).toBe('running')
    expect(r.steps[0]).toMatchObject({ status: 'ok', output_summary: 'PA #30' })
    expect(r.last_event_id).toBe(2)
  })

  it('never moves a step backwards when a late `started` arrives after `completed`', () => {
    let r = applyStepEvent(base(), { idx: 1, name: 'upload_to_nea', status: 'ok', output_summary: 'NEA# 47731888', evidence: [neaRef] }, 5)
    r = applyStepEvent(r, { idx: 1, name: 'upload_to_nea', status: 'running', output_summary: 'uploading…' }, 4)
    expect(r.steps[1]).toMatchObject({ status: 'ok', output_summary: 'NEA# 47731888', evidence_ids: ['ev_nea'] })
    expect(r.last_event_id).toBe(5)
  })

  it('is idempotent under replay (same event twice)', () => {
    const ev = { idx: 1, name: 'upload_to_nea', status: 'ok' as const, evidence: [neaRef], progress_line: 'read PMS imaging' }
    const once = applyStepEvent(base(), ev, 3)
    const twice = applyStepEvent(once, ev, 3)
    expect(twice).toEqual(once)
    expect(twice.evidence).toHaveLength(1)
    expect(twice.steps[1]?.progress_lines).toEqual(['read PMS imaging'])
  })

  it('a `done` that adds nothing after the run is already terminal is a clean end, not a desync', () => {
    const cancelled = applyStatusEvent(applyStatusEvent(base(), { status: 'running' }, 1), { status: 'cancelled' }, 2)
    expect(reduceRunMessage(cancelled, { id: null, event: 'done', data: '{"run_id": "run_1"}' }).result).toBe('done')
    expect(reduceRunMessage(cancelled, { id: null, event: 'done', data: '{"status": ' }).result).toBe('done')
  })

  it('a replayed `running` step does not resume a paused run: only a status event does', () => {
    const running = applyStepEvent(base(), { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'running' }, 1)
    const paused = applyStatusEvent(running, { status: 'paused' }, 2)
    const replayed = applyStepEvent(paused, { idx: 0, name: 'fetch_pa_from_pms_imaging', status: 'running' }, 1)
    expect(replayed.status).toBe('paused')
    expect(applyStatusEvent(replayed, { status: 'running' }, 3).status).toBe('running')
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

  it('folds GET /runs/{id} RunDetail into the cached view; a mutation\'s bare Run replays from the start', () => {
    const { evidence: _e, last_event_id: _l, ...run } = base()
    const view = runViewOf({ run, evidence: [nea], last_event_id: 7 })
    expect(view.evidence.map((e) => e.id)).toEqual(['ev_nea'])
    expect(view.last_event_id).toBe(7)
    expect(runViewOf(run)).toMatchObject({ evidence: [], last_event_id: null })
  })

  it('a malformed `done` never marks the run succeeded: the stream is desynced and the run refetched', () => {
    const running = applyStatusEvent(base(), { status: 'running' }, 1)
    const fx = reduceRunMessage(running, { id: 9, event: 'done', data: '{"status": "succeeded", "audit_line": ' })
    expect(fx.result).toBe('desynced')
    expect(fx.refetchRun).toBe(true)
    expect(fx.run?.status).toBe('running')
    expect(fx.run?.last_event_id).toBe(1)
    // Parses as JSON but not as a done payload (unknown status): same outcome.
    const odd = reduceRunMessage(running, { id: 9, event: 'done', data: '{"status": "finished"}' })
    expect(odd).toMatchObject({ result: 'desynced', refetchRun: true })
    expect(odd.run?.status).toBe('running')
    // A done without a status says nothing about the outcome either.
    const bare = reduceRunMessage(running, { id: 9, event: 'done', data: '{}' })
    expect(bare.result).toBe('desynced')
    expect(bare.run?.status).toBe('running')
    expect(applyDoneEvent(running, {}, 9).status).toBe('running')
  })

  it('after a desync, the server\'s failed status is what renders', () => {
    const running = applyStatusEvent(base(), { status: 'running' }, 1)
    const stuck = reduceRunMessage(running, { id: 9, event: 'done', data: 'not json' }).run
    const merged = mergeSnapshot(stuck, { ...base(), status: 'failed', audit_line: 'Upload to NEA failed' })
    expect(merged.status).toBe('failed')
    expect(merged.audit_line).toBe('Upload to NEA failed')
  })

  it('a well-formed `done` finishes the stream with the server-sent status', () => {
    const fx = reduceRunMessage(applyStatusEvent(base(), { status: 'running' }, 1), { id: 9, event: 'done', data: '{"status":"failed"}' })
    expect(fx).toMatchObject({ result: 'done', refetchRun: true })
    expect(fx.run?.status).toBe('failed')
  })
})
