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
import { RunDoneEvent, RunStatusEvent, RunStepEvent, StripSummary } from '@/api/schema'
import type { Evidence, Run, RunDetail, RunStatus, RunStep, RunStepStatus, RunView } from '@/api/schema'
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
  if ('run' in src) return { ...src.run, evidence: src.evidence, last_event_id: src.last_event_id }
  return { ...src, evidence: [], last_event_id: null }
}

function nextStepStatus(current: RunStepStatus, incoming: RunStepStatus): RunStepStatus {
  return STEP_RANK[incoming] >= STEP_RANK[current] ? (STEP_RANK[current] === 2 ? current : incoming) : current
}

/** paused ⇄ running may flip either way (pause/resume); nothing leaves a terminal state. */
export function nextRunStatus(current: RunStatus, incoming: RunStatus): RunStatus {
  if (isTerminal(current)) return current
  if (RUN_RANK[incoming] < RUN_RANK[current]) return current
  return incoming
}

function withEvidence(run: RunView, ev: Evidence | null | undefined): RunView {
  if (!ev || run.evidence.some((e) => e.id === ev.id)) return run
  return { ...run, evidence: [...run.evidence, ev] }
}

function bumpId(run: RunView, id: number | null): RunView {
  if (id === null) return run
  return id > (run.last_event_id ?? -1) ? { ...run, last_event_id: id } : run
}

export function applyStepEvent(run: RunView, ev: RunStepEvent, eventId: number | null): RunView {
  const existing = run.steps.find((s) => s.idx === ev.idx)
  const base: RunStep = existing ?? {
    idx: ev.idx,
    name: ev.name,
    status: 'pending',
    progress_lines: [],
    evidence_ids: [],
  }
  const status = nextStepStatus(base.status, ev.status)
  const progress =
    ev.progress_line && !base.progress_lines.includes(ev.progress_line)
      ? [...base.progress_lines, ev.progress_line]
      : base.progress_lines
  const evidenceIds = ev.evidence && !base.evidence_ids.includes(ev.evidence.id) ? [...base.evidence_ids, ev.evidence.id] : base.evidence_ids
  const step: RunStep = {
    ...base,
    name: ev.name || base.name,
    status,
    // A late, stale event must not overwrite the summary written by the terminal one.
    output_summary: STEP_RANK[ev.status] >= STEP_RANK[base.status] ? (ev.output_summary ?? base.output_summary) : base.output_summary,
    policy_verdict: ev.policy_verdict ?? base.policy_verdict,
    progress_lines: progress,
    evidence_ids: evidenceIds,
  }
  const steps = existing ? run.steps.map((s) => (s.idx === ev.idx ? step : s)) : [...run.steps, step].sort((a, b) => a.idx - b.idx)
  // A step that is running implies the run is running.
  const runStatus = ev.status === 'running' ? nextRunStatus(run.status, 'running') : run.status
  return bumpId(withEvidence({ ...run, steps, status: runStatus }, ev.evidence), eventId)
}

export function applyStatusEvent(
  run: RunView,
  ev: { status: RunStatus; model_situation_label?: string | null; planner?: Run['planner'] },
  eventId: number | null,
): RunView {
  return bumpId(
    {
      ...run,
      status: nextRunStatus(run.status, ev.status),
      model_situation_label: ev.model_situation_label ?? run.model_situation_label,
      planner: ev.planner ?? run.planner,
    },
    eventId,
  )
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
    merged = applyStepEvent(
      merged,
      { idx: step.idx, name: step.name, status: step.status, output_summary: step.output_summary, policy_verdict: step.policy_verdict },
      null,
    )
    for (const line of step.progress_lines) {
      merged = applyStepEvent(merged, { idx: step.idx, name: step.name, status: 'pending', progress_line: line }, null)
    }
  }
  for (const ev of cached.evidence) merged = withEvidence(merged, ev)
  merged = { ...merged, audit_line: snapshot.audit_line ?? cached.audit_line, result_summary: snapshot.result_summary ?? cached.result_summary }
  merged = { ...merged, status: nextRunStatus(cached.status, snapshot.status) }
  if (isTerminal(snapshot.status)) merged = { ...merged, status: snapshot.status }
  return merged
}

/**
 * What one SSE frame does: the next cached view, whether the stream goes on, and what to refetch.
 * `desynced` = the stream ended on a frame we could not read (or a `done` without a status): the view keeps
 * its last known status and the caller refetches GET /runs/{id} for the server's, never assuming success.
 */
export interface RunMessageEffect {
  run: RunView | undefined
  result: 'continue' | 'done' | 'desynced'
  /** Refetch ['run', id] (the stored run carries what the stream does not, or the outcome is unknown). */
  refetchRun: boolean
  counts?: StripSummary
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
    case 'counts': {
      const ev = StripSummary.safeParse(data)
      return ev.success ? { ...keep, counts: ev.data } : keep
    }
    case 'done': {
      const ev = RunDoneEvent.safeParse(data)
      if (!ev.success) return { run, result: 'desynced', refetchRun: true }
      return { run: run && applyDoneEvent(run, ev.data, msg.id), result: ev.data.status ? 'done' : 'desynced', refetchRun: true }
    }
    default:
      return keep
  }
}

/** Step names come from the recipe (snake_case); this is the copy shown in the panel. */
export function stepLabel(name: string): string {
  const s = name.replace(/^act:/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
