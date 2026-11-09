/**
 * Pure reducer that folds run SSE events into the cached Run (`['run', id]`).
 *
 * Events can arrive twice (replay after reconnect) or out of order (a late `started` after `completed`).
 * The merge is therefore monotonic: a step's status only moves forward (pending → running → terminal),
 * a run's status only moves forward, progress lines are de-duplicated, and `last_event_id` is the max seen.
 * Applying the same event twice is a no-op, so replay from `Last-Event-ID` can never corrupt the view.
 *
 * The reducer never invents a run status: a `done` without a status (or one that fails to parse, see
 * hooks/useRun.ts) leaves the status alone, and the caller refetches GET /runs/{id} for the server's.
 */
import { RunDoneEvent, RunStatusEvent, RunStepEvent } from '@/api/schema'
import type { Run, RunDetail, RunEvidenceRef, RunStatus, RunStep, RunStepStatus, RunView, RunViewEvidence, RunViewStep } from '@/api/schema'
import type { SseMessage } from './sse'

const STEP_RANK: Record<RunStepStatus, number> = { pending: 0, running: 1, ok: 2, failed: 2, skipped: 2 }
const RUN_RANK: Record<RunStatus, number> = {
  queued: 0,
  running: 1,
  paused: 1,
  succeeded: 2,
  failed: 2,
  cancelled: 2,
  would_have_run: 2,
}

export const TERMINAL_RUN: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled', 'would_have_run']
export const isTerminal = (s: RunStatus) => TERMINAL_RUN.includes(s)

/** The cached view of a run: GET /runs/{id}'s RunDetail flattened, or a mutation's bare Run (no evidence yet, replay from the start). */
export function runViewOf(src: RunDetail | Run): RunView {
  if ('run' in src) return { ...src.run, steps: viewSteps(src.run), evidence: src.evidence, last_event_id: src.last_event_id }
  return { ...src, steps: viewSteps(src), evidence: [], last_event_id: null }
}

const viewSteps = (run: Run): RunViewStep[] => (run.steps ?? []).map(viewStep)
const viewStep = (s: RunStep): RunViewStep => ({ ...s, progress_lines: s.progress_lines ?? [], evidence_ids: s.evidence_ids ?? [] })

function nextStepStatus(current: RunStepStatus, incoming: RunStepStatus): RunStepStatus {
  return STEP_RANK[incoming] >= STEP_RANK[current] ? (STEP_RANK[current] === 2 ? current : incoming) : current
}

/** paused ⇄ running may flip either way (pause/resume); nothing leaves a terminal state. */
export function nextRunStatus(current: RunStatus, incoming: RunStatus): RunStatus {
  if (isTerminal(current)) return current
  if (RUN_RANK[incoming] < RUN_RANK[current]) return current
  return incoming
}

function withEvidence(run: RunView, ev: RunViewEvidence | RunEvidenceRef): RunView {
  if (run.evidence.some((e) => e.id === ev.id)) return run
  return { ...run, evidence: [...run.evidence, ev] }
}

function bumpId(run: RunView, id: number | null): RunView {
  if (id === null) return run
  return id > (run.last_event_id ?? -1) ? { ...run, last_event_id: id } : run
}

export function applyStepEvent(run: RunView, ev: RunStepEvent, eventId: number | null): RunView {
  const existing = run.steps.find((s) => s.idx === ev.idx)
  const base: RunViewStep = existing ?? {
    idx: ev.idx,
    name: ev.name,
    label: '',
    status: 'pending',
    tool: '',
    input_summary: '',
    output_summary: '',
    progress_lines: [],
    evidence_ids: [],
  }
  const status = nextStepStatus(base.status, ev.status)
  const lines = [...(ev.progress_lines ?? []), ...(ev.progress_line ? [ev.progress_line] : [])]
  const evidence = ev.evidence ?? []
  const evidenceIds = [...(ev.evidence_ids ?? []), ...evidence.map((e) => e.id)]
  const step: RunViewStep = {
    ...base,
    name: ev.name || base.name,
    label: ev.label || base.label,
    status,
    // A late, stale event must not overwrite the summary written by the terminal one.
    output_summary: STEP_RANK[ev.status] >= STEP_RANK[base.status] ? ev.output_summary || base.output_summary : base.output_summary,
    policy_verdict: ev.policy_verdict ?? base.policy_verdict,
    progress_lines: addNew(base.progress_lines, lines),
    evidence_ids: addNew(base.evidence_ids, evidenceIds),
  }
  const steps = existing ? run.steps.map((s) => (s.idx === ev.idx ? step : s)) : [...run.steps, step].sort((a, b) => a.idx - b.idx)
  // A running step starts a queued run. It never resumes a paused one: that takes a status event, and this may be a replay.
  const runStatus = ev.status === 'running' && run.status === 'queued' ? 'running' : run.status
  const next: RunView = {
    ...run,
    steps,
    status: runStatus,
    model_situation_label: ev.model_situation_label ?? run.model_situation_label,
    planner: ev.planner ?? run.planner,
  }
  return bumpId(evidence.reduce(withEvidence, next), eventId)
}

/** Lists only grow, and replay repeats them, so a step's lines and evidence ids are a set in arrival order. */
const addNew = (have: string[], incoming: string[]): string[] => {
  const fresh = incoming.filter((x, i) => !have.includes(x) && incoming.indexOf(x) === i)
  return fresh.length ? [...have, ...fresh] : have
}

export function applyStatusEvent(
  run: RunView,
  ev: { status: RunStatus; planner?: Run['planner'] | null },
  eventId: number | null,
): RunView {
  return bumpId({ ...run, status: nextRunStatus(run.status, ev.status), planner: ev.planner ?? run.planner }, eventId)
}

/** A `done` with no status keeps the current one: only the server says how a run ended. */
export function applyDoneEvent(
  run: RunView,
  ev: { status?: RunStatus | null; audit_line?: string | null; result_summary?: string | null },
  eventId: number | null,
): RunView {
  return bumpId(
    {
      ...run,
      status: ev.status ? nextRunStatus(run.status, ev.status) : run.status,
      audit_line: ev.audit_line ?? run.audit_line,
      result_summary: ev.result_summary ?? run.result_summary,
    },
    eventId,
  )
}

/** Merge a fresh GET /runs/{id} snapshot with what SSE already delivered (keeps the furthest-along view). */
export function mergeSnapshot(cached: RunView | undefined, snapshot: RunView): RunView {
  if (!cached) return snapshot
  let merged: RunView = { ...snapshot, last_event_id: Math.max(snapshot.last_event_id ?? -1, cached.last_event_id ?? -1) }
  for (const step of cached.steps) {
    merged = applyStepEvent(merged, step, null)
  }
  for (const ev of cached.evidence) merged = withEvidence(merged, ev)
  // The API defaults both to '', so "not written yet" is falsy, not null.
  merged = { ...merged, audit_line: snapshot.audit_line || cached.audit_line, result_summary: snapshot.result_summary || cached.result_summary }
  merged = { ...merged, status: nextRunStatus(cached.status, snapshot.status) }
  if (isTerminal(snapshot.status)) merged = { ...merged, status: snapshot.status }
  return merged
}

/**
 * What one SSE frame does: the next cached view, whether the stream goes on, and what to refetch.
 * `desynced` = the stream ended on a frame we could not read (or a `done` without a status) with the run not yet known to
 * be over: the view keeps its last known status and the caller refetches GET /runs/{id}, never assuming success.
 */
export interface RunMessageEffect {
  run: RunView | undefined
  result: 'continue' | 'done' | 'desynced'
  /** Refetch ['run', id] (the stored run carries what the stream does not, or the outcome is unknown). */
  refetchRun: boolean
}

export function reduceRunMessage(run: RunView | undefined, msg: SseMessage): RunMessageEffect {
  let data: unknown
  try {
    data = JSON.parse(msg.data) as unknown
  } catch {
    data = undefined
  }
  const keep: RunMessageEffect = { run, result: 'continue', refetchRun: false }
  switch (msg.event) {
    case 'step': {
      const ev = RunStepEvent.safeParse(data)
      if (!ev.success) return keep
      // `decide` carries the agent's label and rationale on the stored run: fetch them once.
      return { run: run && applyStepEvent(run, ev.data, msg.id), result: 'continue', refetchRun: Boolean(ev.data.policy_verdict) }
    }
    case 'status': {
      const ev = RunStatusEvent.safeParse(data)
      return ev.success ? { ...keep, run: run && applyStatusEvent(run, ev.data, msg.id) } : keep
    }
    // `counts` falls through: the frame has no viewer and no location, so it cannot be the strip; `done` refetches that.
    case 'done': {
      const ev = RunDoneEvent.safeParse(data)
      const next = ev.success && run ? applyDoneEvent(run, ev.data, msg.id) : run
      const ended = (ev.success && Boolean(ev.data.status)) || (run !== undefined && isTerminal(run.status))
      return { run: next, result: ended ? 'done' : 'desynced', refetchRun: true }
    }
    default:
      return keep
  }
}
