/**
 * Claim detail. One request (GET /claims/{id}) brings lines, attachments, acks, readiness, the merged
 * timeline and open items — no N+1. `?from=inbox:<id>` keeps the Inbox breadcrumb ("1 of 3" is read
 * from the cached Inbox list if present); `?launch=` shows a run started here ("Ask Follow-up to look").
 */
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { InboxList } from '@/api/schema'
import { qk } from '@/api/queryKeys'
import { isApiError } from '@/api/client'
import { useClaim } from '@/hooks/useClaims'
import { ageTone, longDate, shortDate } from '@/lib/format'
import { PAYER_NAME } from '@/lib/payers'
import { useLaunches } from '@/state/launches'
import { PageHeader } from '@/components/PageHeader'
import { StatusChip } from '@/components/StatusChip'
import { FlagPill } from '@/components/FlagPill'
import { MoneyMath } from '@/components/MoneyMath'
import { ReadinessChecklist } from '@/components/ReadinessChecklist'
import { Timeline } from '@/components/Timeline'
import { ProgressPanel } from '@/components/ProgressPanel'
import { TriageButton } from '@/components/TriageButton'
import { QueryError } from '@/components/QueryError'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonBlock, SkeletonRows } from '@/components/ui/Skeleton'
import { AcksList, Attachments, LinesTable } from './ClaimSections'
import { OpenItemsPanel } from './OpenItemsPanel'
import { parseFrom } from './search'
import type { ReactNode } from 'react'

const route = getRouteApi('/claims/$claimId')

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-lg border border-line bg-white px-3 py-2 ${className ?? ''}`}>
      <h3 className="m-0 mb-1.5 text-2xs font-extrabold uppercase tracking-[.05em] text-mid">{title}</h3>
      {children}
    </section>
  )
}

function useBreadcrumbPosition(itemId: string | undefined): string | null {
  const qc = useQueryClient()
  if (!itemId) return null
  for (const [, list] of qc.getQueriesData<InboxList>({ queryKey: qk.inbox.lists() })) {
    const g = list?.groups.find((x) => x.item_ids.includes(itemId))
    if (g) return `${g.item_ids.indexOf(itemId) + 1} of ${g.count}`
  }
  return null
}

export function ClaimDetailPage() {
  const { claimId } = route.useParams()
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/claims/$claimId' })
  const claim = useClaim(claimId)
  const launches = useLaunches()
  const from = parseFrom(search.from)
  const position = useBreadcrumbPosition(from?.kind === 'inbox' ? from.itemId : undefined)
  const launch = launches.find((l) => l.id === search.launch)
  const openLaunch = (id: string) => void navigate({ search: (s) => ({ ...s, launch: id }), replace: true })

  if (claim.isPending) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Claim" />
        <div className="p-5">
          <SkeletonBlock className="mb-3 h-16" />
          <SkeletonRows rows={8} />
        </div>
      </div>
    )
  }
  if (claim.isError) {
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader title="Claim" />
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

  const c = claim.data
  const tone = ageTone(c.age_days)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={`Claim #${c.number}`} sub={`${c.patient.name} · ${PAYER_NAME[c.payer_key]}`}>
        <TriageButton claim={c} onLaunched={(l) => openLaunch(l.id)} />
      </PageHeader>
      <nav aria-label="Breadcrumb" className="flex flex-none items-center gap-2 border-b border-line bg-fill px-[18px] py-1.5 text-sm text-mid">
        {from?.kind === 'inbox' ? (
          <Link to="/inbox" search={{ item: from.itemId }} className="font-semibold text-acc no-underline hover:underline">
            ‹ Inbox
          </Link>
        ) : (
          <Link to="/claims" className="font-semibold text-acc no-underline hover:underline">
            ‹ Claims
          </Link>
        )}
        <span>›</span>
        <b className="text-ink">
          #{c.number} · {PAYER_NAME[c.payer_key]}
          {position ? ` · ${position}` : ''}
        </b>
        {c.icn && <span>ICN {c.icn}</span>}
        {c.needs_action && <FlagPill label="needs action" />}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-3.5">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-3">
          {launch && <ProgressPanel launch={launch} fromInbox={false} onClose={() => void navigate({ search: (s) => ({ ...s, launch: undefined }), replace: true })} />}
          <OpenItemsPanel claim={c} onLaunched={(l) => openLaunch(l.id)} />
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[18px] font-bold">{c.patient.name}</h2>
            <span className="text-sm text-mid">
              {[c.patient.dob ? `DOB ${longDate(c.patient.dob)}` : null, c.plan_label ?? PAYER_NAME[c.payer_key], `DOS ${longDate(c.dos)}`, c.provider_name].filter(Boolean).join(' · ')}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <StatusChip status={c.status} />
              {c.denial && (
                <b className="text-sm">
                  {c.denial.carc}
                  {c.denial.rarc ? ` · ${c.denial.rarc}` : ''}
                </b>
              )}
              {c.age_days !== null && c.age_days !== undefined && (
                <span className="text-sm text-mid">
                  age {c.age_days} d{tone ? ` · ${tone === 'ok' ? '0–30' : tone === 'warn' ? '31–60' : tone === 'bad' ? '61–90' : '90+'}` : ''}
                </span>
              )}
            </span>
          </div>
          <MoneyMath claim={c} />
          {c.denial && (
            <p className="m-0 rounded-md border border-bad-line bg-bad-bg px-3 py-1.5 text-sm">
              <b>
                Denial {c.denial.carc}
                {c.denial.rarc ? ` · ${c.denial.rarc}` : ''}
              </b>{' '}
              — {c.denial.decoded}
              {c.denial.root_cause === 'ours' && <b className="ml-1 text-bad">Root cause: ours.</b>}
              {c.deadline && c.deadline.kind !== 'none' && (
                <span className="text-mid">
                  {' '}
                  · {c.deadline.kind.replace('_', ' ')} due {c.deadline.due_on ? shortDate(c.deadline.due_on) : '—'} ({c.deadline.basis})
                </span>
              )}
            </p>
          )}
          <div className="grid grid-cols-[1.35fr_1fr] gap-3">
            <div className="flex min-w-0 flex-col gap-3">
              <Card title="Line items">
                <LinesTable lines={c.lines} />
              </Card>
              <Card title="Timeline">
                <Timeline entries={c.timeline} nowLabel={c.in_flight ? c.in_flight : c.open_inbox_items.length ? 'Awaiting approval' : undefined} />
              </Card>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <Card title="Attachments">
                <Attachments attachments={c.attachments} />
              </Card>
              <Card title="Acknowledgements">
                <AcksList acks={c.acks} />
              </Card>
              <Card title="Readiness checks">
                <ReadinessChecklist checks={c.readiness} />
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
