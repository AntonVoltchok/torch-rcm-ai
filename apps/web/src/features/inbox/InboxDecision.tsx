/**
 * D1's decision pane for the selected item, or for its batch when the group is open. Every word that says what will
 * happen is the server's: the button is `action_label`, "What this does" is `touches`, "Why it stopped at you" is
 * `stopped_by`, the signer's reason is `signer_note`. The list row carries enough to draw the head at once; the plan,
 * draft, audit note, evidence and hold window come from GET /inbox/{id}. Edit/Reject/Snooze forms are ephemeral UI
 * state owned by InboxPage.
 */
import { Link } from '@tanstack/react-router'
import type { InboxGroup, InboxItem } from '@/api/schema'
import { useInboxItem } from '@/hooks/useInbox'
import { useAlwaysAutoRun } from '@/hooks/useInboxActions'
import { isApiError } from '@/api/client'
import { time } from '@/lib/format'
import { AGENT_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { session, USERS } from '@/state/session'
import { Baton } from '@/components/Baton'
import { RelayRow, RelayTable } from '@/components/RelayTable'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Kbd'
import { SkeletonBlock } from '@/components/ui/Skeleton'
import type { FileDeparted } from '@/hooks/useInboxActions'
import { DraftText } from './DraftText'
import { EvidenceRows } from './EvidenceRows'
import { EditPlanForm, RejectForm, SnoozeMenu } from './ItemForms'
import { draftOf, isBlocked } from './selectors'

export type DetailPanel = 'none' | 'edit' | 'reject' | 'snooze'

const ALTERNATIVE_LABEL: Record<string, string> = { corrected_claim: 'corrected claim (freq. 7)' }

interface Props {
  item: InboxItem
  /** The open batch this item belongs to: the pane decides for all of it. */
  group: { group: InboxGroup; members: InboxItem[] } | null
  panel: DetailPanel
  setPanel: (p: DetailPanel) => void
  now: string | undefined
  departed: FileDeparted | null
  busy: boolean
  /** Why actions are locked (a run holds this claim), or null. */
  lock: { reason: string } | null
  onApprove: (edits?: Record<string, unknown>) => void
  onApproveGroup: () => void
  onReject: (reason: string) => void
  onSnooze: (until: string, label: string) => void
  onCorrected: () => void
}

const H3 = 'm-0 text-sm font-semibold leading-[18px]'

function Touches({ title, touches, className }: { title: string; touches: string[]; className?: string }) {
  if (touches.length === 0) return null
  return (
    <div className={className} data-testid="touches">
      <h3 className={H3}>{title}</h3>
      <ul className="m-0 mt-0.5 list-none p-0 text-sm text-mid">
        {touches.map((t) => (
          <li key={t} className="relative pl-[13px] leading-[1.45] before:absolute before:left-0 before:top-[7px] before:size-1 before:rounded-full before:bg-[#A7AFBC]">
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function InboxDecision(p: Props) {
  const { item, group } = p
  const detail = useInboxItem(item.id)
  const autoRun = useAlwaysAutoRun()
  const blocked = isBlocked(item)
  const members = group?.members ?? [item]
  const claim = item.claim
  const payer = claim ? claim.payer.short_name : null
  const draft = detail.data ? draftOf(detail.data.payload, detail.data.evidence) : null
  const hold = detail.data?.hold_window
  const auditNote = detail.data?.audit_note
  const actionLabel = (group ? group.group.action_label : item.action_label) ?? (item.kind === 'owner_signoff' ? 'Sign and apply' : 'Approve and run')
  const touches = group ? group.group.touches : item.touches
  const signers = USERS.filter((u) => u.role === item.required_role)
  const refusal = isApiError(autoRun.error, 'root_cause_guard') || isApiError(autoRun.error, 'tier_not_learnable') ? autoRun.error.message : null
  const canPropose = item.rule_id !== null && item.tier !== null && item.tier !== 3
  const locked = p.lock !== null
  const off = p.busy || locked

  return (
    <article aria-label={`Inbox item ${item.title}`} className="px-6 pb-[22px] pt-5" data-testid="decision">
      <h1 className="m-0 text-title font-semibold tracking-[-.014em] [text-wrap:balance]">{group ? group.group.title : item.title}</h1>
      {item.summary && <p className="m-0 mt-1.5 leading-normal text-mid">{item.summary}</p>}
      {item.root_cause === 'ours' && auditNote && (
        <p className="m-0 mt-3 rounded-md border border-risk-line bg-risk-bg px-3 py-2 text-risk-ink" data-testid="audit-note">
          {auditNote}
        </p>
      )}

      <RelayTable count={members.length} payer={payer ?? undefined}>
        {members.map((m) => {
          const c = m.claim
          const name = (
            <>
              <span className="font-semibold">{m.patient?.display_name ?? c?.patient.display_name}</span>
              {c && <span className="text-mid"> #{c.number}</span>}
              {c && <span className="text-mid"> {c.procedures_plain}</span>}
            </>
          )
          return (
            <RelayRow
              key={m.id}
              selected={members.length > 1 && m.id === item.id}
              name={
                c ? (
                  <Link to="/claims/$claimId" params={{ claimId: c.id }} search={{ from: `inbox:${m.id}` }} title={`Open claim #${c.number}`} className="text-ink no-underline hover:underline">
                    {name}
                  </Link>
                ) : (
                  name
                )
              }
              cents={m.cents}
              status={c?.status}
              baton={
                c ? (
                  <Baton who={c.move.who} held={c.move.mine ? 'mine' : 'other'} size="lg" next={blocked ? null : m.lands} label={c.move.label || undefined} />
                ) : (
                  <Baton who="practice" size="lg" next={m.lands} label="With you: an upcoming visit" />
                )
              }
            />
          )
        })}
      </RelayTable>

      {blocked ? (
        <>
          <div className="mt-3.5 grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border border-practice-line bg-practice-bg px-4 py-3.5" data-testid="signer">
            <div>
              <h2 className="m-0 text-md font-semibold">{claim?.move.label || 'Someone else signs this'}</h2>
              <p className="m-0 mt-0.5 text-sm">{item.signer_note}</p>
            </div>
            {signers.map((u) => (
              <Button key={u.id} onClick={() => session.set({ userId: u.id })}>
                Switch to {u.name}
              </Button>
            ))}
          </div>
          <Touches title="What the signature does" touches={touches} className="mt-3.5" />
        </>
      ) : (
        <div className="mt-3.5 grid grid-cols-[auto_1fr] items-start gap-6">
          <div>
            {p.departed ? (
              <Button variant="primary" size="lg" onClick={p.onCorrected} disabled={p.busy}>
                Build a corrected claim
              </Button>
            ) : group ? (
              <Button variant="primary" size="lg" kbd="⇧A" onClick={p.onApproveGroup} disabled={off}>
                {actionLabel}
              </Button>
            ) : (
              <Button variant="primary" size="lg" kbd="A" onClick={() => p.onApprove()} disabled={off}>
                {actionLabel}
              </Button>
            )}
            <div className="mt-1.5 flex gap-1 text-sm">
              {group && claim && (
                <Button variant="ghost" size="sm" kbd="A" onClick={() => p.onApprove()} disabled={off || Boolean(p.departed)}>
                  Only #{claim.number}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => p.setPanel('edit')} disabled={off || Boolean(p.departed)}>
                Edit plan
              </Button>
              <Button variant="ghost" size="sm" onClick={() => p.setPanel('reject')} disabled={off}>
                Reject
              </Button>
              <Button variant="ghost" size="sm" onClick={() => p.setPanel('snooze')} disabled={off}>
                Snooze
              </Button>
            </div>
            {p.lock && (
              <p role="status" className="m-0 mt-1.5 text-sm font-medium text-agents-ink" data-testid="locked">
                {p.lock.reason}. Approve opens when the run ends.
              </p>
            )}
            {p.departed && <p className="m-0 mt-1.5 max-w-[280px] text-sm">{p.departed.message}</p>}
          </div>
          <div>
            <Touches title={item.tier === 3 ? 'What your signature does' : 'What this does'} touches={touches} />
            {hold && (
              <p className="m-0 mt-1 text-xs text-soft" data-testid="hold-window">
                {hold.departed
                  ? `The ${time(hold.file_time)} file has left. Now: ${hold.alternatives.map((a) => ALTERNATIVE_LABEL[a] ?? a.replace(/_/g, ' ')).join(', ') || 'nothing'}.`
                  : `Editable until ${time(hold.editable_until)}, then it leaves in the ${time(hold.file_time)} file.`}
              </p>
            )}
          </div>
        </div>
      )}

      {p.panel === 'edit' && <EditPlanForm item={item} busy={p.busy} onCancel={() => p.setPanel('none')} onSubmit={(edits) => p.onApprove(edits)} />}
      {p.panel === 'reject' && <RejectForm busy={p.busy} onCancel={() => p.setPanel('none')} onSubmit={p.onReject} />}
      {p.panel === 'snooze' && p.now && <SnoozeMenu now={p.now} onCancel={() => p.setPanel('none')} onPick={p.onSnooze} />}

      <div className="mt-4 grid grid-cols-[1fr_1.35fr_1fr] gap-5 border-t border-line pt-3.5">
        <div data-testid="stopped-by">
          <h3 className={H3}>Why it stopped at {blocked ? 'a person' : 'you'}</h3>
          <p className="m-0 mt-0.5 text-sm leading-[1.45] text-mid">{item.stopped_by}</p>
        </div>
        <div>
          <h3 className={H3}>{item.agent ? `${AGENT_NAME[item.agent]} agent recommends` : 'Recommended'}</h3>
          <p className="m-0 mt-0.5 text-sm leading-[1.45] text-mid">{item.recommendation}</p>
        </div>
        <div data-testid="track-record">
          <h3 className={H3}>Track record</h3>
          <p className="m-0 mt-0.5 text-sm leading-[1.45] text-mid">
            {item.confidence?.pct != null && <strong className="mr-1 font-semibold text-ink">{Math.round(item.confidence.pct)}%</strong>}
            {item.confidence?.basis ?? 'No track record for this situation yet.'}
          </p>
        </div>
      </div>

      {canPropose && (
        <div className={cn('mt-3 rounded-md bg-fill px-3 py-2 text-sm text-mid', refusal && 'border border-line-strong')} data-testid="policy">
          {refusal ? (
            <p role="alert" className="m-0" data-testid="guard-reason">
              <strong className="font-semibold text-ink">Always auto-run is off the table here.</strong> {refusal}
            </p>
          ) : (
            <p className="m-0">
              Want items like this to run without you?{' '}
              <button type="button" className="font-medium text-act hover:underline disabled:text-soft" disabled={autoRun.isPending} onClick={() => autoRun.mutate(item)}>
                Propose always auto-run
              </button>
            </p>
          )}
        </div>
      )}

      {draft && <DraftText draft={draft} payer={payer} />}

      {detail.isPending ? (
        <SkeletonBlock className="mt-4 h-40" />
      ) : detail.isError ? (
        <p className="mt-4 text-sm text-risk-ink">
          Evidence unavailable.{' '}
          <button type="button" className="underline" onClick={() => void detail.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <EvidenceRows evidence={detail.data.evidence} />
      )}

      {item.root_cause !== 'ours' && auditNote && (
        <p className="m-0 mt-3 text-sm text-mid" data-testid="audit-note">
          {auditNote}
        </p>
      )}
      <p className="m-0 mt-3.5 text-xs text-soft">
        <Kbd>J</Kbd> <Kbd>K</Kbd> move through your list{blocked ? '' : group ? ', ⇧A approves the batch' : ', A approves'}
      </p>
    </article>
  )
}

