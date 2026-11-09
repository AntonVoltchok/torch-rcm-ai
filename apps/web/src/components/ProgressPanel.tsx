/**
 * A launch (Approve, Approve 3, Ask Follow-up to look) as D1's run pane. Not optimistic: every step's status, label,
 * output and evidence comes from SSE events folded into ['run', id] (hooks/useRun.ts). Each claim keeps its relay row
 * from the decision, and its baton is the claim's own server `move`, refetched when the run ends. When every run has
 * ended, "What changed" shows the server's before/after for this approval (`Launch.changes`, from ApproveOut), unless a
 * run failed: then those numbers no longer hold, and the failed step's own words lead instead.
 * In the Inbox the pane opens on the click, before the server answers: `starting` draws the relay rows with
 * "Starting…" and no steps, and the same instance takes the launch when the 202 lands (InboxPage keys it by attempt).
 * What a reviewer needs to trust a run stays one click away: the reads a live agent chose, its label and rationale,
 * the policy verdict, the planner and the audit line.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { PlannerKind, PolicyVerdict, RunStep, RunView, RunViewStep, StripChange } from '@/api/schema'
import { claimQuery } from '@/hooks/useClaims'
import { useRun, type StreamMode } from '@/hooks/useRun'
import { useStrip } from '@/hooks/useStrip'
import { isTerminal } from '@/lib/runEvents'
import { AGENT_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import type { Launch, LaunchedRun } from '@/state/launches'
import { Baton } from './Baton'
import { Chip } from './Chip'
import { HolderTally } from './HolderTally'
import { RelayRow, RelayTable } from './RelayTable'

const PLANNER_LABEL: Record<PlannerKind, string> = {
  live: 'live agent',
  scripted: 'scripted',
  recorded_plan: 'recorded agent plan',
  scripted_fallback: 'fell back to rules',
}

const VERDICT: Record<PolicyVerdict, { label: string; tone: 'ok' | 'act' | 'caution' | 'risk' | 'dashed' }> = {
  execute: { label: 'Policy: runs without review', tone: 'ok' },
  propose: { label: 'Policy: ask Dana → Inbox', tone: 'act' },
  observe: { label: 'Policy: observe · would have run', tone: 'dashed' },
  refuse: { label: 'Policy: refused', tone: 'risk' },
  park: { label: 'Policy: parked (agents paused)', tone: 'caution' },
}

function StepDot({ status }: { status: RunStep['status'] }) {
  const base =
    'relative z-[1] mt-0.5 flex size-4 flex-none items-center justify-center rounded-full text-xs font-bold leading-none text-white'
  if (status === 'ok') return <span className={cn(base, 'bg-agents')}>✓</span>
  if (status === 'failed') return <span className={cn(base, 'bg-risk')}>✕</span>
  if (status === 'running')
    return (
      <span
        className={cn(base, 'animate-pulse bg-paper shadow-[inset_0_0_0_5px_var(--color-agents)]')}
        aria-label="running"
      />
    )
  if (status === 'skipped')
    return <span className={cn(base, 'bg-paper text-soft shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]')}>–</span>
  return (
    <span className={cn(base, 'bg-paper shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]')} aria-label="pending" />
  )
}

function StepRow({ step, run, last }: { step: RunViewStep; run: RunView; last: boolean }) {
  const evidence = run.evidence.filter((e) => step.evidence_ids.includes(e.id))
  const isDecide = step.name === 'decide'
  const rationale = run.plan?.rationale
  return (
    <li
      data-step={step.name}
      data-status={step.status}
      className={cn(
        'relative grid grid-cols-[16px_1fr] gap-2.5 pb-3 last:pb-0',
        !last && 'before:absolute before:bottom-px before:left-[7px] before:top-[19px] before:w-0.5',
        !last && (step.status === 'ok' ? 'before:bg-agents' : 'before:bg-line'),
      )}
    >
      <StepDot status={step.status} />
      <div className="min-w-0">
        <div
          className={cn(
            step.status === 'pending'
              ? 'text-soft'
              : step.status === 'failed'
                ? 'font-medium text-risk-ink'
                : 'text-ink',
            step.status === 'running' && 'font-medium',
          )}
        >
          {step.label || step.name}
        </div>
        {step.progress_lines.length > 0 && (
          <ul className="m-0 list-none p-0 text-sm text-mid">
            {step.progress_lines.map((l) => (
              <li key={l}>↳ {l}</li>
            ))}
          </ul>
        )}
        {isDecide && run.model_situation_label && (
          <div className="text-sm text-mid">Agent’s label: “{run.model_situation_label}”</div>
        )}
        {isDecide && typeof rationale === 'string' && rationale && <p className="m-0 text-sm text-mid">{rationale}</p>}
        {step.output_summary && step.output_summary !== step.label && (
          <small className="block text-sm text-mid">{step.output_summary}</small>
        )}
        {step.policy_verdict && (
          <Chip tone={VERDICT[step.policy_verdict].tone} className="mt-0.5">
            {VERDICT[step.policy_verdict].label}
          </Chip>
        )}
        {evidence.map((e) => (
          <Chip key={e.id} tone="neutral" className="mr-1 mt-0.5">
            {e.kind === 'nea_attachment' && e.reference ? `NEA# ${e.reference}` : e.title}
          </Chip>
        ))}
      </div>
    </li>
  )
}

function RunMeta({ run, mode }: { run: RunView; mode: StreamMode }) {
  return (
    <p className="m-0 mt-2 text-xs text-soft">
      {[
        run.planner ? PLANNER_LABEL[run.planner] : null,
        isTerminal(run.status)
          ? null
          : mode === 'desynced'
            ? 'stream lost, checking the server every 2 s'
            : mode === 'poll'
              ? 'updating every 2 s'
              : 'live',
      ]
        .filter(Boolean)
        .join(', ')}
    </p>
  )
}

/** One claim's run: its relay row (the toggle) and, open, its steps. */
function RunBlock({
  launched,
  fromItem,
  expanded,
  onToggle,
  onRun,
}: {
  launched: LaunchedRun
  fromItem: boolean
  expanded: boolean
  onToggle: () => void
  onRun: (id: string, run: RunView | undefined) => void
}) {
  const { run, mode, error } = useRun(launched.run_id)
  const claim = useQuery({ ...claimQuery(launched.claim_id ?? 'none'), enabled: Boolean(launched.claim_id) }).data
    ?.claim
  useEffect(() => {
    onRun(launched.run_id, run)
  }, [launched.run_id, run, onRun])
  const done = run ? run.steps.filter((s) => s.status === 'ok').length : 0
  const where = !run
    ? ''
    : run.status === 'queued'
      ? 'Queued'
      : run.status === 'paused'
        ? 'Paused'
        : isTerminal(run.status)
          ? run.status === 'failed'
            ? 'Stopped'
            : run.status === 'cancelled'
              ? 'Cancelled'
              : 'Done'
          : `Step ${Math.min(done + 1, run.steps.length)} of ${run.steps.length}`
  return (
    <section
      aria-label={`Run ${launched.label}`}
      data-run={launched.run_id}
      data-run-status={run?.status}
      className="border-b border-line last:border-b-0"
    >
      <RelayRow
        className="border-b-0"
        name={
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex min-w-0 items-center gap-1.5 text-left"
          >
            <span
              aria-hidden
              className={cn(
                'inline-block size-1.5 flex-none border-b-[1.5px] border-r-[1.5px] border-soft',
                expanded ? 'rotate-45' : '-rotate-45',
              )}
            />
            <span className="truncate font-semibold">{launched.label}</span>
            <span
              className={cn('flex-none text-sm', run?.status === 'failed' ? 'font-medium text-risk-ink' : 'text-mid')}
            >
              {where}
            </span>
          </button>
        }
        cents={claim?.billed_cents}
        status={claim?.status}
        baton={
          claim ? (
            <Baton
              who={claim.move.who}
              held={claim.move.mine ? 'mine' : 'other'}
              size="lg"
              label={claim.move.label || undefined}
            />
          ) : null
        }
      />
      {error ? <p className="m-0 px-3 pb-2 text-sm text-risk-ink">Could not load this run.</p> : null}
      {run && expanded && (
        <div className="px-3 pb-3 pl-[30px]">
          <ol className="m-0 list-none p-0">
            {run.steps.map((s, i) => (
              <StepRow key={s.idx} step={s} run={run} last={i === run.steps.length - 1} />
            ))}
          </ol>
          {run.audit_line && (
            <p
              className="m-0 mt-2 rounded-md border border-line bg-fill px-2 py-1 font-mono text-xs text-mid"
              data-testid="audit-line"
            >
              Audit: {run.audit_line}
            </p>
          )}
          <div className="mt-1 flex items-center gap-3">
            <RunMeta run={run} mode={mode} />
            {launched.claim_id && (
              <Link
                to="/claims/$claimId"
                params={{ claimId: launched.claim_id }}
                search={fromItem && launched.item_id ? { from: `inbox:${launched.item_id}` } : {}}
                className="ml-auto mt-2 whitespace-nowrap text-sm font-medium text-act no-underline hover:underline"
              >
                Open claim {launched.label.split(' ')[0]} →
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/** A claim the pending approval will run on: its relay row, before the server has named the run. */
function StartingBlock({ row }: { row: StartingRow }) {
  const claim = useQuery({ ...claimQuery(row.claim_id ?? 'none'), enabled: Boolean(row.claim_id) }).data?.claim
  return (
    <section aria-label={`Run ${row.label}`} data-run-status="starting" className="border-b border-line last:border-b-0">
      <RelayRow
        className="border-b-0"
        name={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold">{row.label}</span>
            <span className="flex-none text-sm text-mid">Starting…</span>
          </span>
        }
        cents={claim?.billed_cents}
        status={claim?.status}
        baton={claim ? <Baton who={claim.move.who} held={claim.move.mine ? 'mine' : 'other'} size="lg" label={claim.move.label || undefined} /> : null}
      />
    </section>
  )
}

function Changes({ changes }: { changes: StripChange[] }) {
  const strip = useStrip().data
  return (
    <div className="rounded-lg border border-line bg-fill px-3.5 py-3" data-testid="changes">
      <h3 className="m-0 text-sm font-semibold">What changed</h3>
      <dl className="m-0 mt-1.5">
        {changes.map((c) => {
          const same = c.before === c.after
          const tile = c.key.startsWith('tile.') ? strip?.tiles.find((t) => `tile.${t.status}` === c.key) : undefined
          const denied = c.key === 'tile.denied'
          return (
            <div
              key={c.key}
              data-change={c.key}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t border-line py-[7px]"
            >
              <dt className={cn('mr-auto font-medium', denied && 'text-risk-ink')}>{c.label}</dt>
              <dd className="m-0 inline-flex items-center gap-1 whitespace-nowrap text-mid">
                {same ? (
                  <>
                    <span className="text-soft">stays</span>{' '}
                    <strong
                      className={cn(
                        'font-semibold text-ink',
                        denied ? 'nums-proportional text-kpi text-risk-ink' : 'text-md',
                      )}
                    >
                      {c.after}
                    </strong>
                  </>
                ) : (
                  <>
                    {c.before} <span className="text-soft">to</span>{' '}
                    <strong className="text-md font-semibold text-ink">{c.after}</strong>
                  </>
                )}
              </dd>
              {denied && tile && <HolderTally rows={tile.by_holder} className="basis-full" />}
              {c.note && <p className="m-0 basis-full text-sm text-mid">{c.note}</p>}
            </div>
          )
        })}
      </dl>
    </div>
  )
}

/** One claim of an approval the server has not answered yet. */
export interface StartingRow {
  label: string
  claim_id: string | null
}

export interface LaunchState {
  /** Every run has ended (the server says so). */
  done: boolean
  /** The runs that failed, with their server views. */
  failed: RunView[]
}

export function ProgressPanel({
  launch,
  onClose,
  fromInbox = true,
  variant = 'card',
  footer,
  starting,
}: {
  launch: Launch
  onClose?: () => void
  fromInbox?: boolean
  /** `pane`: D1's run pane, taking the Inbox's decision pane after Approve. `card`: a boxed panel inside another screen. */
  variant?: 'card' | 'pane'
  /** What to do next, once every run has ended (the Inbox's Next). */
  footer?: (s: LaunchState) => ReactNode
  /** The approval is on its way and the server has not named its runs: these rows show "Starting…". */
  starting?: StartingRow[]
}) {
  // `undefined` until the reader toggles: the first run opens, including when it arrives after "Starting…".
  const [toggled, setOpen] = useState<string | null | undefined>(undefined)
  const open = toggled === undefined ? (launch.runs[0]?.run_id ?? null) : toggled
  const [runs, setRuns] = useState<Record<string, RunView | undefined>>({})
  const onRun = useRef((id: string, run: RunView | undefined) => {
    setRuns((cur) => (cur[id] === run ? cur : { ...cur, [id]: run }))
  }).current
  const views = launch.runs.map((r) => runs[r.run_id])
  const done = views.length > 0 && views.every((v) => v !== undefined && isTerminal(v.status))
  const failed = views.filter((v): v is RunView => v?.status === 'failed')
  const firstFailedStep = failed[0]?.steps.find((s) => s.status === 'failed')
  const agent = launch.kind === 'triage' ? AGENT_NAME.followup : null
  const heading = launch.action_label ?? launch.title
  const pane = variant === 'pane'

  const headRef = useRef<HTMLHeadingElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  // Once per pane: when "Starting…" becomes the launch, the heading is the same and keeps its focus.
  useEffect(() => {
    if (pane) headRef.current?.focus()
  }, [pane])
  useEffect(() => {
    if (pane && done) footRef.current?.querySelector('button')?.focus({ preventScroll: true })
  }, [pane, done])

  const wasStarting = useRef(Boolean(starting))
  if (starting) wasStarting.current = true
  const summary = starting
    ? 'Your approval is on its way to the server.'
    : !done && wasStarting.current
      ? 'Started. The steps show as they run.'
      : done
    ? failed.length > 0
      ? failed[0]?.result_summary || firstFailedStep?.output_summary || 'A step failed.'
      : views.length === 1
        ? views[0]?.result_summary || 'Done.'
        : `All ${views.length} runs finished.`
    : null

  const outcome = (
    <div
      className={cn(
        'mt-4 grid items-start gap-6',
        (done ? failed.length === 0 && launch.changes?.length : launch.touches?.length)
          ? 'grid-cols-[minmax(0,1fr)_minmax(0,340px)]'
          : 'grid-cols-1',
      )}
    >
      <div>
        <div className={cn(failed.length > 0 && 'rounded-lg border border-risk-line bg-risk-bg px-3.5 py-3')}>
          <h2 className={cn('m-0 text-md font-semibold', failed.length > 0 && 'text-risk-ink')}>
            {done ? (failed.length > 0 ? 'Stopped, and nothing more was done' : 'Finished') : starting ? 'Starting…' : 'Agents are on it'}
          </h2>
          <p aria-live="polite" className="m-0 mt-0.5 text-sm text-ink">
            {summary}
          </p>
          {done &&
            failed.length > 0 &&
            firstFailedStep?.output_summary &&
            failed[0]?.result_summary &&
            firstFailedStep.output_summary !== failed[0].result_summary && (
              <p className="m-0 mt-1 text-sm" data-testid="failed-step">
                {firstFailedStep.label}: {firstFailedStep.output_summary}
              </p>
            )}
        </div>
        <p className="m-0 mt-2 text-xs text-soft">
          Runs in the background, so you can leave this screen. Steps resume after a reload.
        </p>
        {done && footer && (
          <div ref={footRef} className="mt-4 flex flex-wrap items-center gap-2.5">
            {footer({ done, failed })}
          </div>
        )}
      </div>
      {!done && launch.touches && launch.touches.length > 0 && (
        <div>
          <h3 className="m-0 text-sm font-semibold">What this does</h3>
          <ul className="m-0 mt-0.5 list-none p-0 text-sm text-mid">
            {launch.touches.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {done && failed.length === 0 && launch.changes && launch.changes.length > 0 && (
        <Changes changes={launch.changes} />
      )}
    </div>
  )

  return (
    <section
      role="region"
      aria-label="Agent progress"
      data-testid="run-pane"
      data-tour="run-pane"
      data-starting={starting ? true : undefined}
      data-done={done || undefined}
      data-failed={failed.length > 0 || undefined}
      className={cn(pane ? 'px-6 pb-[22px] pt-5' : 'rounded-lg border border-line bg-paper px-4 py-3.5')}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1
            ref={headRef}
            tabIndex={-1}
            className={cn('m-0 font-semibold tracking-[-.014em] outline-none', pane ? 'text-title' : 'text-md')}
          >
            {agent ? `${agent} agent: ${launch.title}` : heading}
          </h1>
          {!agent && launch.action_label && <p className="m-0 mt-1.5 text-mid">{launch.title}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close progress"
            className="rounded-md px-1.5 text-lg leading-none text-mid hover:bg-hover hover:text-ink"
          >
            ×
          </button>
        )}
      </div>

      {done && outcome}
      <RelayTable count={starting ? starting.length : launch.runs.length}>
        {starting?.map((r, i) => <StartingBlock key={i} row={r} />)}
        {launch.runs.map((r) => (
          <RunBlock
            key={r.run_id}
            launched={r}
            fromItem={fromInbox}
            expanded={open === r.run_id}
            onToggle={() => {
              setOpen((cur) => (cur === r.run_id ? null : r.run_id))
            }}
            onRun={onRun}
          />
        ))}
      </RelayTable>

      {!done && outcome}
    </section>
  )
}
