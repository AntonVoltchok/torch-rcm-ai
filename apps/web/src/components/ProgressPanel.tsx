/**
 * Live agent run(s). Not optimistic: every step's status, output and evidence comes from SSE events
 * folded into ['run', id] (see hooks/useRun.ts). Shows what a reviewer needs to trust the run — the
 * reads a live agent chose (`progress_lines` under investigate), the agent's own label, rationale and
 * the policy verdict under decide, the planner that produced the plan, and the audit line at the end.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { PlannerKind, PolicyVerdict, RunStep, RunView, RunViewStep } from '@/api/schema'
import { useRun, type StreamMode } from '@/hooks/useRun'
import { isTerminal, stepLabel } from '@/lib/runEvents'
import { AGENT_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import type { Launch, LaunchedRun } from '@/state/launches'
import { Chip } from './Chip'

const PLANNER_LABEL: Record<PlannerKind, string> = {
  live: 'live agent',
  scripted: 'scripted',
  recorded_plan: 'recorded agent plan',
  scripted_fallback: 'fell back to rules',
}

const VERDICT: Record<PolicyVerdict, { label: string; tone: 'ok' | 'acc' | 'warn' | 'bad' | 'dashed' }> = {
  execute: { label: 'Policy: runs without review', tone: 'ok' },
  propose: { label: 'Policy: ask Dana → Inbox', tone: 'acc' },
  observe: { label: 'Policy: observe · would have run', tone: 'dashed' },
  refuse: { label: 'Policy: refused', tone: 'bad' },
  park: { label: 'Policy: parked (agents paused)', tone: 'warn' },
}

function StepDot({ status }: { status: RunStep['status'] }) {
  const base = 'mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 text-2xs font-extrabold text-white'
  if (status === 'ok') return <span className={cn(base, 'border-ok bg-ok')}>✓</span>
  if (status === 'failed') return <span className={cn(base, 'border-bad bg-bad')}>✕</span>
  if (status === 'running') return <span className={cn(base, 'animate-torch-spin border-light border-t-acc')} aria-label="running" />
  if (status === 'skipped') return <span className={cn(base, 'border-line text-soft')}>–</span>
  return <span className={cn(base, 'border-dashed border-soft')} aria-label="pending" />
}

function StepRow({ step, run }: { step: RunViewStep; run: RunView }) {
  const evidence = run.evidence.filter((e) => step.evidence_ids.includes(e.id))
  const isDecide = step.name === 'decide'
  const rationale = run.plan?.rationale
  return (
    <li data-step={step.name} data-status={step.status} className="flex gap-2.5 py-1">
      <StepDot status={step.status} />
      <div className="min-w-0 flex-1">
        <div className={cn('font-semibold', step.status === 'pending' && 'text-soft')}>{step.label || stepLabel(step.name)}</div>
        {step.progress_lines.length > 0 && (
          <ul className="m-0 list-none p-0 text-xs text-mid">
            {step.progress_lines.map((l) => (
              <li key={l}>↳ {l}</li>
            ))}
          </ul>
        )}
        {isDecide && run.model_situation_label && (
          <div className="mt-0.5 text-sm">
            Agent’s label: <b>“{run.model_situation_label}”</b>
          </div>
        )}
        {isDecide && typeof rationale === 'string' && rationale && <p className="m-0 mt-0.5 text-xs text-mid">{rationale}</p>}
        {step.output_summary && <small className="block text-xs text-mid">{step.output_summary}</small>}
        {step.policy_verdict && (
          <Chip tone={VERDICT[step.policy_verdict].tone} className="mt-0.5">
            {VERDICT[step.policy_verdict].label}
          </Chip>
        )}
        {evidence.map((e) => (
          <Chip key={e.id} tone="acc" className="mr-1 mt-0.5">
            {e.kind === 'nea_attachment' && e.reference ? `NEA# ${e.reference}` : e.title}
          </Chip>
        ))}
        {step.status === 'failed' && <div className="text-xs font-semibold text-bad">Step failed — sent back to the Inbox as a new item.</div>}
      </div>
    </li>
  )
}

function RunStatusLine({ run, mode }: { run: RunView; mode: StreamMode }) {
  const done = run.steps.filter((s) => s.status === 'ok').length
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-mid">
      {run.status === 'queued' && <Chip tone="dashed">queued</Chip>}
      {run.status === 'paused' && <Chip tone="warn">paused</Chip>}
      {run.status === 'running' && (
        <span>
          step {Math.min(done + 1, run.steps.length)} of {run.steps.length}
        </span>
      )}
      {run.status === 'succeeded' && <Chip tone="ok">done</Chip>}
      {run.status === 'failed' && <Chip tone="bad">failed</Chip>}
      {run.status === 'cancelled' && <Chip tone="warn">cancelled</Chip>}
      {run.planner && <span>· {PLANNER_LABEL[run.planner]}</span>}
      {!isTerminal(run.status) && <span>· {mode === 'desynced' ? 'stream lost · checking the server every 2 s' : mode === 'poll' ? 'updating every 2 s' : 'live'}</span>}
    </span>
  )
}

function RunBlock({ launched, fromItem, expanded, onToggle }: { launched: LaunchedRun; fromItem: boolean; expanded: boolean; onToggle: () => void }) {
  const { run, mode, error } = useRun(launched.run_id)
  return (
    <section aria-label={`Run ${launched.label}`} data-run={launched.run_id} className="border-t border-acc-line pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 items-center gap-1.5 text-left font-bold" aria-expanded={expanded}>
          <span className="text-soft">{expanded ? '▾' : '▸'}</span>
          <span className="truncate">{launched.label}</span>
        </button>
        {run && <RunStatusLine run={run} mode={mode} />}
        {launched.claim_id && (
          <Link
            to="/claims/$claimId"
            params={{ claimId: launched.claim_id }}
            search={fromItem && launched.item_id ? { from: `inbox:${launched.item_id}` } : {}}
            className="ml-auto whitespace-nowrap text-sm font-semibold text-acc no-underline hover:underline"
          >
            Open claim {launched.label.split(' ')[0]} →
          </Link>
        )}
      </div>
      {error ? <p className="text-sm text-bad">Could not load this run.</p> : null}
      {run && expanded && (
        <>
          <ol className="m-0 mt-1 list-none p-0">
            {run.steps.map((s) => (
              <StepRow key={s.idx} step={s} run={run} />
            ))}
          </ol>
          {run.audit_line && (
            <p className="m-0 mt-1 rounded border border-line bg-white px-2 py-1 font-mono text-xs text-mid" data-testid="audit-line">
              Audit · {run.audit_line}
            </p>
          )}
        </>
      )}
    </section>
  )
}

export function ProgressPanel({ launch, onClose, fromInbox = true }: { launch: Launch; onClose?: () => void; fromInbox?: boolean }) {
  const [open, setOpen] = useState<string | null>(launch.runs[0]?.run_id ?? null)
  const agent = launch.kind === 'triage' ? AGENT_NAME.followup : null
  return (
    <div role="region" aria-label="Agent progress" className="rounded-lg border border-acc-line bg-acc-bg px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-2xs font-extrabold uppercase tracking-[.06em] text-acc">
        <span>✦ {agent ? `${agent} agent` : 'Agent run'} · {launch.title}</span>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close progress" className="ml-auto text-base font-normal normal-case text-mid hover:text-ink">
            ×
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {launch.runs.map((r) => (
          <RunBlock
            key={r.run_id}
            launched={r}
            fromItem={fromInbox}
            expanded={open === r.run_id}
            onToggle={() => {
              setOpen((cur) => (cur === r.run_id ? null : r.run_id))
            }}
          />
        ))}
      </div>
      <p className="m-0 mt-2 text-xs text-mid">Runs in the background — you can leave this screen. Steps resume after a reload.</p>
    </div>
  )
}
