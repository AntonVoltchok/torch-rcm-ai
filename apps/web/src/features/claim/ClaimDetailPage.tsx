/**
 * Claim detail (D1). One request (GET /claims/{id}) brings lines, attachments, acks, the merged timeline and open
 * items: no N+1. The header says whose move it is (`claim.move`), the money that matters and the deadline, over
 * the history as party lanes; the body is the open item, the denial decoded, money, lines; the side panel is the
 * timeline. `?from=` sets the back link ("1 of 3" from the cached Inbox, "Next denial" from the cached worklist);
 * `?launch=` shows a run started here.
 */
import type { ReactNode } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { ClaimDetail, DenialsOut, InboxList } from '@/api/schema'
import { inboxGroups } from '@/features/inbox/selectors'
import { daysUntil, deadlineVerb, isPatientResp, worklistOrder } from '@/features/denials/selectors'
import { qk } from '@/api/queryKeys'
import { isApiError } from '@/api/client'
import { useClaim } from '@/hooks/useClaims'
import { useNow } from '@/hooks/useClock'
import { longDate, money, practiceDay } from '@/lib/format'
import { PAYER_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { useLaunches } from '@/state/launches'
import { Baton, batonProps, PARTY_TEXT } from '@/components/Baton'
import { StatusChip } from '@/components/StatusChip'
import { moneyIsEstimate } from '@/components/MoneyMath'
import { Timeline } from '@/components/Timeline'
import { ReadinessChecklist } from '@/components/ReadinessChecklist'
import { ProgressPanel } from '@/components/ProgressPanel'
import { TriageButton } from '@/components/TriageButton'
import { QueryError } from '@/components/QueryError'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonBlock, SkeletonRows } from '@/components/ui/Skeleton'
import { AttachmentsAndAcks, Card, DenialCard, LinesTable, MoneyCard } from './ClaimSections'
import { HistoryLanes } from './HistoryLanes'
import { OpenItemsPanel } from './OpenItemsPanel'
import { parseFrom } from './search'

const route = getRouteApi('/claims/$claimId')
const crumb = 'font-medium text-mid no-underline hover:text-ink'

function useInboxPosition(itemId: string | undefined): string | null {
  const qc = useQueryClient()
  if (!itemId) return null
  for (const [, list] of qc.getQueriesData<InboxList>({ queryKey: qk.inbox.lists() })) {
    const g = list && inboxGroups(list).find((x) => x.item_ids.includes(itemId))
    if (g) return `${g.item_ids.indexOf(itemId) + 1} of ${g.count}`
  }
  return null
}

/** The next claim on the cached Denials worklist, in screen order; null when not from Denials or at the end. */
function useNextDenial(claimId: string, fromDenials: boolean): { id: string; label: string; position: string } | null {
  const qc = useQueryClient()
  const list = fromDenials ? qc.getQueryData<DenialsOut>(qk.denials) : undefined
  if (!list) return null
  const rows = worklistOrder(list)
  const i = rows.findIndex((r) => r.claim.id === claimId)
  const next = i >= 0 ? rows[i + 1] : undefined
  return next ? { id: next.claim.id, label: `${next.claim.patient.display_name} #${next.claim.number}`, position: `${i + 1} of ${rows.length}` } : null
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-soft">{label}</dt>
      <dd className={cn('m-0 mt-0.5 flex items-center gap-2 text-base font-semibold', className)}>{children}</dd>
    </div>
  )
}

function Header({ d, today }: { d: ClaimDetail; today: string | undefined }) {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/claims/$claimId' })
  const c = d.claim
  const from = parseFrom(search.from)
  const position = useInboxPosition(from?.kind === 'inbox' ? from.itemId : undefined)
  const next = useNextDenial(c.id, from?.kind === 'denials')
  const payer = d.payer.short_name
  const est = moneyIsEstimate(d.money)
  const due = d.deadline.due_on
  const days = due && today ? daysUntil(due, today) : null
  const pr = d.denial && isPatientResp(d.denial.carc)
  return (
    <header className="panel mx-4 mb-3 flex-none px-5 pb-4 pt-2.5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-3 text-sm">
        {from?.kind === 'inbox' ? (
          <Link to="/inbox" search={{ item: from.itemId }} className={crumb}>
            ‹ Inbox
          </Link>
        ) : from?.kind === 'denials' ? (
          <Link to="/denials" search={{ row: c.id }} className={crumb}>
            ‹ Denials
          </Link>
        ) : (
          <Link to="/claims" className={crumb}>
            ‹ Claims
          </Link>
        )}
        {position && <span className="text-soft">{position} in this group</span>}
        {next && (
          <Link
            to="/claims/$claimId"
            params={{ claimId: next.id }}
            search={{ from: 'denials:' }}
            className="ml-auto font-medium text-act no-underline hover:underline"
          >
            Next denial: {next.label} <span className="font-normal text-soft">({next.position})</span>
          </Link>
        )}
      </nav>
      <div className="mt-2 flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="min-w-[280px] max-w-[540px] flex-1">
          <h1 className="m-0 text-title font-semibold">
            {d.patient.display_name} <span className="sr-only">claim </span>
            <span className="font-normal text-mid">#{c.number}</span>
          </h1>
          <p className="m-0 mt-0.5 text-sm text-mid">
            {PAYER_NAME[d.payer.key]}, {d.coverage.plan_name}. Seen {longDate(c.dos)} by {d.provider_name}, {d.location_name}.
            {c.icn ? (
              <>
                {' '}
                ICN <span className="select-all whitespace-nowrap font-medium text-ink">{c.icn}</span>.
              </>
            ) : null}
          </p>
          <p className="m-0 mt-0.5 text-sm text-mid">{c.procedures_plain}</p>
        </div>
        <dl className="m-0 flex flex-wrap gap-x-7 gap-y-3">
          <Fact label="Status">
            <StatusChip status={c.status} />
          </Fact>
          <Fact label="Whose move" className={PARTY_TEXT[c.move.who]}>
            <Baton {...batonProps(c.move)} size="md" decorative />
            {c.move.mine && c.move.who === 'practice' ? 'Waiting on you' : c.move.label}
          </Fact>
          <Fact label="Billed">{money(c.billed_cents)}</Fact>
          {pr && d.money.patient_resp_cents !== null ? (
            <Fact label="Patient owes, per the 835">{money(d.money.patient_resp_cents)}</Fact>
          ) : est && d.money.insurance_est_cents !== null ? (
            <Fact label={`Expected from ${payer}, est.`}>{money(d.money.insurance_est_cents)}</Fact>
          ) : (
            <Fact label="Paid">{money(d.money.paid_cents)}</Fact>
          )}
          <Fact label={deadlineVerb(d.deadline.kind)} className={days !== null && days <= 30 ? 'text-risk-ink' : undefined}>
            {due ? `${longDate(due)}${days !== null ? `, ${days} days` : ''}` : <span className="font-normal text-mid">None on file</span>}
          </Fact>
        </dl>
        <div className="ml-auto self-center">
          <TriageButton claim={d} onLaunched={(l) => void navigate({ search: (s) => ({ ...s, launch: l.id }), replace: true })} />
        </div>
      </div>
      <div className="mt-4 overflow-x-auto border-t border-line pt-3">
        <HistoryLanes claim={d} />
      </div>
    </header>
  )
}

export function ClaimDetailPage() {
  const { claimId } = route.useParams()
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/claims/$claimId' })
  const claim = useClaim(claimId)
  const now = useNow()
  const launches = useLaunches()
  const launch = launches.find((l) => l.id === search.launch)

  if (claim.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <SkeletonBlock className="h-40 rounded-panel" />
        <SkeletonRows rows={8} />
      </div>
    )
  }
  if (claim.isError) {
    return (
      <div className="panel mx-4 mb-4 flex flex-1 flex-col">
        {isApiError(claim.error, 'not_found') ? (
          <EmptyState title="Claim not found" action={<Link to="/claims">Back to Claims</Link>}>
            {claimId} is not in this practice.
          </EmptyState>
        ) : (
          <QueryError error={claim.error} what="the claim" onRetry={() => void claim.refetch()} />
        )}
      </div>
    )
  }

  const d = claim.data
  const c = d.claim
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Header d={d} today={now ? practiceDay(now) : undefined} />
      <div className="grid grid-cols-[minmax(0,1fr)_clamp(320px,30vw,416px)] gap-3 px-4 pb-4">
        <div className="grid min-w-0 grid-cols-2 content-start gap-3">
          <div className="col-span-2 flex flex-col gap-3">
            <OpenItemsPanel claim={d} />
            {launch && <ProgressPanel launch={launch} fromInbox={false} onClose={() => void navigate({ search: (s) => ({ ...s, launch: undefined }), replace: true })} />}
          </div>
          {d.denial ? <DenialCard d={d} /> : null}
          <div className={cn(!d.denial && 'col-span-2')}>
            <MoneyCard m={d.money} plan={d.coverage.plan_name} payer={d.payer.short_name} denial={d.denial} />
          </div>
          {(c.status === 'ready' || d.holds.length > 0) && d.readiness.length > 0 && (
            <Card title="Before it can be sent" label="Readiness checks" className="col-span-2">
              <ReadinessChecklist checks={d.readiness} />
            </Card>
          )}
          <Card title="Lines" className="col-span-2">
            <LinesTable lines={d.lines} estimate={moneyIsEstimate(d.money)} />
          </Card>
          <Card title="Attachments and acknowledgments" label="Attachments and acknowledgments" className="col-span-2">
            <AttachmentsAndAcks attachments={d.attachments} acks={d.acks} />
          </Card>
        </div>
        <aside aria-label="Claim timeline" className="panel min-w-0 self-start px-4 py-3.5">
          <section aria-label="Timeline">
            <h2 className="m-0 mb-2 text-base font-semibold">What happened</h2>
            <Timeline entries={d.timeline} nowLabel={c.in_flight ? c.in_flight : d.open_inbox_items.length ? 'Awaiting a decision' : undefined} />
          </section>
        </aside>
      </div>
    </div>
  )
}
