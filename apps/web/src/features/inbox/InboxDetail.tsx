/**
 * The selected item. The header renders from the list row at once (API `InboxItemOut` carries the claim and
 * patient references); the plan, audit note, evidence and hold window come from GET /inbox/{id}
 * (`InboxItemDetail`). Edit/Reject/Snooze panels are ephemeral UI state owned by InboxPage.
 */
import { Link } from '@tanstack/react-router'
import type { InboxGroup, InboxItem } from '@/api/schema'
import { useInboxItem } from '@/hooks/useInbox'
import { useAlwaysAutoRun } from '@/hooks/useInboxActions'
import { isApiError } from '@/api/client'
import { money, shortDate, time } from '@/lib/format'
import { AGENT_NAME, PAYER_NAME } from '@/lib/payers'
import { useCurrentUser } from '@/state/session'
import { Button } from '@/components/ui/Button'
import { SkeletonBlock } from '@/components/ui/Skeleton'
import { ConfidenceMeter } from '@/components/ConfidenceMeter'
import { EvidenceList } from '@/components/EvidenceCard'
import { DraftText } from './DraftText'
import { draftOf } from './selectors'
import { FlagPill } from '@/components/FlagPill'
import { StatusChip } from '@/components/StatusChip'
import { TierBadge } from '@/components/TierBadge'
import { EditPlanForm, RejectForm, SnoozeMenu } from './ItemForms'
import type { FileDeparted } from '@/hooks/useInboxActions'

export type DetailPanel = 'none' | 'edit' | 'reject' | 'snooze'

const ALTERNATIVE_LABEL: Record<string, string> = { corrected_claim: 'corrected claim (freq. 7)' }

interface Props {
  item: InboxItem
  group: { group: InboxGroup; position: number } | null
  panel: DetailPanel
  setPanel: (p: DetailPanel) => void
  now: string | undefined
  departed: FileDeparted | null
  busy: boolean
  onApprove: (edits?: Record<string, unknown>) => void
  onApproveGroup: () => void
  onReject: (reason: string) => void
  onSnooze: (until: string, label: string) => void
  onCorrected: () => void
}

export function InboxDetail(p: Props) {
  const { item } = p
  const detail = useInboxItem(item.id)
  const user = useCurrentUser()
  const autoRun = useAlwaysAutoRun()
  const { claim, patient } = item
  const rootCause = item.root_cause
  const planSteps = detail.data?.plan_steps ?? []
  const auditNote = detail.data?.audit_note
  const hold = detail.data?.hold_window
  const draft = detail.data ? draftOf(detail.data.payload, detail.data.evidence) : null
  const ownerOnly = item.tier === 3 && user.role !== 'owner'
  const guardReason = isApiError(autoRun.error, 'root_cause_guard') || isApiError(autoRun.error, 'tier_not_learnable') ? autoRun.error.message : null

  return (
    <article aria-label={`Inbox item ${item.title}`} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-5 py-3.5">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[18px] font-bold">{claim ? `#${claim.number} · ${patient?.display_name ?? claim.patient.display_name}` : item.title}</h2>
        {claim && <StatusChip status={claim.status} />}
        {claim?.reason && <span className="text-sm font-semibold text-mid">{claim.reason}</span>}
        {claim?.needs_action && <FlagPill label="needs action" />}
        {item.tier ? <TierBadge tier={item.tier} compact /> : null}
        {claim ? (
          <Link to="/claims/$claimId" params={{ claimId: claim.id }} search={{ from: `inbox:${item.id}` }} className="ml-auto text-sm font-semibold text-acc no-underline hover:underline">
            Open claim →
          </Link>
        ) : item.appointment_id ? (
          <Link to="/eligibility" search={{ appt: item.appointment_id }} className="ml-auto text-sm font-semibold text-acc no-underline hover:underline">
            Open eligibility →
          </Link>
        ) : null}
      </header>
      <div className="text-sm text-mid">
        {[
          claim ? PAYER_NAME[claim.payer.key] : null,
          claim ? `DOS ${shortDate(claim.dos)}` : null,
          claim?.procedures,
          claim ? `billed ${money(claim.billed_cents)}` : null,
          p.group ? `${p.group.position} of ${p.group.group.count}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>

      {item.summary && (
        <p className="m-0">
          <b>What happened.</b> {item.summary}
        </p>
      )}

      <section aria-label="Recommendation" className="rounded-lg border border-acc-line bg-acc-bg px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1.5 text-2xs font-extrabold uppercase tracking-[.06em] text-acc">
          {item.kind === 'owner_signoff' ? 'Rule change · needs your signature' : `✦ ${item.agent ? `${AGENT_NAME[item.agent]} agent` : 'Agent'} recommends`}
          <span className="flex-1" />
          {item.confidence && <ConfidenceMeter pct={item.confidence.pct} compact />}
        </div>
        <p className="m-0 font-semibold">{item.recommendation}</p>
        {planSteps.length > 0 && (
          <ol className="m-0 mt-1.5 pl-5 text-sm">
            {planSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        <p className="m-0 mt-1.5 text-xs text-mid">
          {item.confidence && item.confidence.pct !== null ? (
            <>
              <b className="text-ink">Why {Math.round(item.confidence.pct)}%:</b> {item.confidence.basis}.{' '}
            </>
          ) : (
            <>
              <b className="text-ink">No confidence score:</b> {item.confidence?.basis ?? 'no base rate for this situation'}.{' '}
            </>
          )}
          {item.kind === 'owner_signoff' ? 'Nothing changes until you sign.' : 'Nothing sent yet.'}
        </p>
        <p className="m-0 mt-1 text-xs text-mid" data-testid="stopped-by">
          <b className="text-ink">Why it stopped here:</b> {item.stopped_by}
        </p>
      </section>

      {draft && <DraftText draft={draft} payer={claim ? PAYER_NAME[claim.payer.key] : null} />}

      {auditNote && (
        <p className="m-0 text-sm" data-testid="audit-note">
          <span className={rootCause === 'ours' ? 'rounded border border-bad-line bg-bad-bg px-1 font-semibold text-bad' : 'font-semibold text-mid'}>{auditNote}</span>
        </p>
      )}

      <section aria-label="Evidence">
        {detail.isPending ? (
          <div className="flex gap-2.5">
            <SkeletonBlock className="h-24 flex-1" />
            <SkeletonBlock className="h-24 flex-1" />
            <SkeletonBlock className="h-24 flex-1" />
          </div>
        ) : detail.isError ? (
          <p className="text-sm text-bad">
            Evidence unavailable.{' '}
            <button type="button" className="underline" onClick={() => void detail.refetch()}>
              Retry
            </button>
          </p>
        ) : (
          <EvidenceList evidence={detail.data.evidence} />
        )}
      </section>

      {p.panel === 'edit' && <EditPlanForm item={item} busy={p.busy} onCancel={() => p.setPanel('none')} onSubmit={(edits) => p.onApprove(edits)} />}
      {p.panel === 'reject' && <RejectForm busy={p.busy} onCancel={() => p.setPanel('none')} onSubmit={p.onReject} />}
      {p.panel === 'snooze' && p.now && <SnoozeMenu now={p.now} onCancel={() => p.setPanel('none')} onPick={p.onSnooze} />}

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
        {p.departed ? (
          <>
            <Button variant="primary" onClick={p.onCorrected} disabled={p.busy}>
              Corrected claim (tier 2)
            </Button>
            <span className="text-sm text-warn">{p.departed.message}</span>
          </>
        ) : (
          <Button variant="primary" kbd="A" onClick={() => p.onApprove()} disabled={p.busy || ownerOnly} title={ownerOnly ? 'Tier 3 commits the practice: Dr. Morgan acts on this.' : undefined}>
            {item.kind === 'owner_signoff' ? 'Sign & apply' : 'Approve & run'}
          </Button>
        )}
        {p.group && (
          <Button kbd="⇧A" onClick={p.onApproveGroup} disabled={p.busy}>
            Approve {p.group.group.count}
          </Button>
        )}
        <Button kbd="E" onClick={() => p.setPanel('edit')} disabled={p.busy || Boolean(p.departed)}>
          Edit plan
        </Button>
        <Button kbd="R" onClick={() => p.setPanel('reject')} disabled={p.busy}>
          Reject
        </Button>
        <Button kbd="S" onClick={() => p.setPanel('snooze')} disabled={p.busy}>
          Snooze
        </Button>
        {item.tier === 1 && (
          <button type="button" className="text-xs font-semibold text-acc hover:underline disabled:text-soft" disabled={autoRun.isPending} onClick={() => autoRun.mutate(item)}>
            Always auto-run this…
          </button>
        )}
        {hold && (
          <span className="ml-auto text-right text-xs text-mid" data-testid="hold-window">
            {hold.departed ? (
              <>
                File left {time(hold.file_time)}
                <br />
                now: {hold.alternatives.map((a) => ALTERNATIVE_LABEL[a] ?? a.replace(/_/g, ' ')).join(' · ') || '—'}
              </>
            ) : (
              <>
                Editable until {time(hold.editable_until)}
                <br />
                leaves in the {time(hold.file_time)} file
              </>
            )}
          </span>
        )}
        {guardReason && (
          <p role="alert" className="m-0 w-full rounded border border-warn-line bg-warn-bg px-2 py-1 text-sm text-warn" data-testid="guard-reason">
            Can’t propose auto-run: {guardReason}
          </p>
        )}
      </footer>
    </article>
  )
}
