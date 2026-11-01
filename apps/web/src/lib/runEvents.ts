/**
 * Pure reducer that folds run SSE events into the cached Run (`['run', id]`).
 *
 * Events can arrive twice (replay after reconnect) or out of order (a late `started` after `completed`).
 * The merge is therefore monotonic: a step's status only moves forward (pending → running → terminal),
 * a run's status only moves forward, progress lines are de-duplicated, and `last_event_id` is the max seen.
 * Applying the same event twice is a no-op, so replay from `Last-Event-ID` can never corrupt the view.
 */
import type { Evidence, Run, RunStatus, RunStep, RunStepEvent, RunStepStatus } from '@/api/schema'

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

function nextStepStatus(current: RunStepStatus, incoming: RunStepStatus): RunStepStatus {
  return STEP_RANK[incoming] >= STEP_RANK[current] ? (STEP_RANK[current] === 2 ? current : incoming) : current
}

/** paused ⇄ running may flip either way (pause/resume); nothing leaves a terminal state. */
export function nextRunStatus(current: RunStatus, incoming: RunStatus): RunStatus {
  if (isTerminal(current)) return current
  if (RUN_RANK[incoming] < RUN_RANK[current]) return current
  return incoming
}

function withEvidence(run: Run, ev: Evidence | null | undefined): Run {
  if (!ev || run.evidence.some((e) => e.id === ev.id)) return run
  return { ...run, evidence: [...run.evidence, ev] }
}

function bumpId(run: Run, id: number | null): Run {
  if (id === null) return run
  return id > (run.last_event_id ?? -1) ? { ...run, last_event_id: id } : run
}

export function applyStepEvent(run: Run, ev: RunStepEvent, eventId: number | null): Run {
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
  run: Run,
  ev: { status: RunStatus; model_situation_label?: string | null; planner?: Run['planner'] },
  eventId: number | null,
): Run {
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

export function applyDoneEvent(
  run: Run,
  ev: { status?: RunStatus | null; audit_line?: string | null; result_summary?: string | null },
  eventId: number | null,
): Run {
  return bumpId(
    {
      ...run,
      status: ev.status ? nextRunStatus(run.status, ev.status) : isTerminal(run.status) ? run.status : 'succeeded',
      audit_line: ev.audit_line ?? run.audit_line,
      result_summary: ev.result_summary ?? run.result_summary,
    },
    eventId,
  )
}

/** Merge a fresh GET /runs/{id} snapshot with what SSE already delivered (keeps the furthest-along view). */
export function mergeSnapshot(cached: Run | undefined, snapshot: Run): Run {
  if (!cached) return snapshot
  let merged: Run = { ...snapshot, last_event_id: Math.max(snapshot.last_event_id ?? -1, cached.last_event_id ?? -1) }
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
  merged = { ...merged, status: nextRunStatus(cached.status, snapshot.status) }
  if (isTerminal(snapshot.status)) merged = { ...merged, status: snapshot.status }
  return merged
}

/** Step names come from the recipe (snake_case); this is the copy shown in the panel. */
export function stepLabel(name: string): string {
  const s = name.replace(/^act:/, '').replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
