/**
 * Denials (D1): who holds the denied claims, then the worklist in the server's groups ("what happens next"),
 * soonest deadline first. Each row: the deadline, whose move (`claim.move`), the claim and its reason with the
 * root cause, what is billed and whether the patient can be billed if it is lost, and one destination: the claim.
 * J/K move the selected row (`?row=`), Enter opens it. The payer × reason panel is the prevention view.
 * Decisions: docs/plans/d1-build.md, "Phase 2 (claim/denials) notes".
 */
import { useEffect } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { DenialRow, DenialsOut, HolderCount, Role } from '@/api/schema'
import { useDenials, useCash } from '@/hooks/useStatic'
import { useStrip } from '@/hooks/useStrip'
import { useNow } from '@/hooks/useClock'
import { useListKeys } from '@/hooks/useListKeys'
import { count, longDate, money, practiceDay } from '@/lib/format'
import { cn } from '@/lib/cn'
import { USERS, useCurrentUser } from '@/state/session'
import { Load } from '@/components/QueryBoundary'
import { EmptyState } from '@/components/EmptyState'
import { Baton, batonProps, PARTY_TEXT, partyWord } from '@/components/Baton'
import { HolderTally } from '@/components/HolderTally'
import { Code } from '@/features/claim/ClaimSections'
import { daysUntil, deadlineVerb, ifWeLose, isPatientResp, sortedRows, worklistOrder } from './selectors'

const route = getRouteApi('/denials/')

const ROLE_WORD: Record<Role, string> = { owner: 'the owner', billing: 'billing', dentist: 'the dentist', front_desk: 'the front desk' }

/** "you", "Dr. Morgan" (a named user), "the owner" (a role with no named user: the client never guesses who). */
function holderWord(h: HolderCount): string {
  if (h.who !== 'practice') return h.who === 'payer' ? 'payers' : partyWord(h.who)
  if (h.mine) return 'you'
  return USERS.find((u) => u.id === h.holder_user_id)?.name ?? (h.holder_role ? ROLE_WORD[h.holder_role] : 'the practice')
}

const moveText = (r: DenialRow) => (r.claim.move.mine && r.claim.move.who === 'practice' ? 'Waiting on you' : r.claim.move.label)

function Summary({ d }: { d: DenialsOut }) {
  const strip = useStrip()
  const tile = strip.data?.tiles.find((t) => t.status === 'denied')
  const first = worklistOrder(d).find((r) => r.claim.move.mine)
  return (
    <section aria-label="Denials summary" data-testid="denials-summary" className="panel mx-4 mb-3 flex flex-none flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3">
      <div className="flex items-baseline gap-3">
        <span className="text-kpi font-semibold text-risk-ink nums-proportional">{count(d.total)}</span>
        <span className="text-sm text-mid">
          denied claims
          {tile && <span className="block">{money(tile.cents)} billed</span>}
        </span>
      </div>
      {tile && tile.by_holder.length > 0 && (
        <div className="flex items-center gap-6 border-l border-line pl-8">
          <HolderTally rows={tile.by_holder} className="[&_.party-tick]:h-4 [&_.party-tick]:w-2" />
          <ul className="m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0">
            {tile.by_holder.map((h) => (
              <li key={`${h.who}-${h.holder_role ?? ''}-${h.holder_user_id ?? ''}`} className="flex items-center gap-2">
                <Baton who={h.who} held={h.mine ? 'mine' : 'other'} decorative />
                <span className={cn('text-title font-semibold', PARTY_TEXT[h.who])}>{h.count}</span>
                <span className="text-sm text-mid">with {holderWord(h)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {first && (
        <Link
          to="/claims/$claimId"
          params={{ claimId: first.claim.id }}
          search={{ from: 'denials:' }}
          className="ml-auto inline-flex h-10 items-center rounded-lg bg-act px-4 text-base font-semibold text-white no-underline hover:bg-act-hover"
        >
          Review {first.claim.patient.display_name} #{first.claim.number}
        </Link>
      )}
    </section>
  )
}

function Deadline({ r, today }: { r: DenialRow; today: string | undefined }) {
  const due = r.deadline.due_on
  if (r.deadline.kind === 'none' || !due) {
    return (
      <>
        <div className="text-base text-mid">No deadline on file</div>
        {isPatientResp(r.carc) && <div className="text-sm text-soft">Nothing to appeal</div>}
      </>
    )
  }
  const days = today ? daysUntil(due, today) : null
  return (
    <>
      {days !== null && <div className={cn('text-md font-semibold', days <= 30 && 'text-risk-ink')}>{days} days</div>}
      <div className="text-sm">
        {deadlineVerb(r.deadline.kind)} {longDate(due)}
      </div>
      <div className="text-xs text-soft">{r.deadline.basis}</div>
    </>
  )
}

function Row({ r, today, selected, onSelect }: { r: DenialRow; today: string | undefined; selected: boolean; onSelect: () => void }) {
  const c = r.claim
  const blocked = c.move.who === 'practice' && !c.move.mine
  return (
    <tr
      data-claim-number={c.number}
      data-row-id={c.id}
      aria-selected={selected}
      // Selecting on a row click, but a link inside it navigates on its own.
      onClick={(e) => {
        if (!(e.target instanceof Element && e.target.closest('a, button'))) onSelect()
      }}
      className={cn('border-b border-line align-top last:border-b-0', selected ? 'bg-act-bg' : 'hover:bg-hover')}
    >
      <td className="py-3 pl-5 pr-4">
        <Deadline r={r} today={today} />
      </td>
      <td className="py-3 pr-4">
        <Baton {...batonProps(c.move)} size="md" decorative />
        <div className={cn('mt-1.5 text-sm font-medium', PARTY_TEXT[c.move.who])}>{moveText(r)}</div>
        {/* Who signs is its own server fact (the rendering dentist attests a formal appeal), shown when the move doesn't say it. */}
        {r.signer && moveText(r) !== `${r.signer} signs` && <div className="text-xs text-mid">{r.signer} signs</div>}
      </td>
      <td className="min-w-0 py-3 pr-4">
        <Link to="/claims/$claimId" params={{ claimId: c.id }} search={{ from: 'denials:' }} className="group text-base text-ink no-underline">
          <b className="font-semibold group-hover:underline">{c.patient.display_name}</b> <span className="text-mid">#{c.number}</span>
        </Link>
        <div className="text-xs text-soft">
          {c.payer.short_name}, seen {longDate(c.dos)}. {c.procedures_plain}
        </div>
        <div className="mt-1 text-sm">
          <span className="font-medium">
            <Code code={r.carc} meaning={r.decoded} />
            {r.rarc && (
              <>
                {' '}
                <Code code={r.rarc} meaning={r.decoded} />
              </>
            )}
          </span>{' '}
          <span className="text-mid">{r.decoded}</span>
        </div>
        <div className="mt-1">
          {r.root_cause === 'ours' ? (
            <span className="inline-block rounded-full border border-risk-line bg-risk-bg px-2 text-xs font-semibold leading-[18px] text-risk-ink">Root cause: ours</span>
          ) : (
            <span className="text-xs text-soft">Root cause: {r.root_cause}</span>
          )}
        </div>
        {r.checklist.length > 0 && (
          <ul aria-label="Before it can be filed" className="m-0 mt-1 list-disc pl-4 text-xs text-mid">
            {r.checklist.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        {c.in_flight && <div className="mt-1 text-xs font-medium text-agents-ink">{c.in_flight}</div>}
      </td>
      <td className="py-3 pr-4 text-right">
        <div className="text-md font-semibold tabular-nums">{money(c.billed_cents)}</div>
        <div className="text-xs text-mid">If lost: {ifWeLose(r)}</div>
      </td>
      <td className="py-3 pr-5 text-right">
        <Link
          to="/claims/$claimId"
          params={{ claimId: c.id }}
          search={{ from: 'denials:' }}
          className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-paper px-3 text-sm font-medium text-ink no-underline hover:bg-hover"
        >
          {blocked ? 'See why' : 'Review'}
        </Link>
        {r.next_action === 'formal_appeal' && (
          <div className="mt-1.5">
            <Link to="/denials/$claimId" params={{ claimId: c.id }} className="text-xs font-medium text-act">
              Appeal workbench →
            </Link>
          </div>
        )}
        {r.next_action === 'bill_patient_link' && (
          <div className="mt-1.5">
            <Link to="/payments" className="text-xs font-medium text-act">
              closes in Payments →
            </Link>
          </div>
        )}
      </td>
    </tr>
  )
}

/** "Reconsideration · resend or inquiry, no signature" → ["reconsideration", "Resend or inquiry, no signature"]. */
function splitLabel(label: string): [string, string | null] {
  const [head = label, ...rest] = label.split(' · ')
  const tail = rest.join(' · ')
  return [head.charAt(0).toLowerCase() + head.slice(1), tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : null]
}

function Worklist({ d, today }: { d: DenialsOut; today: string | undefined }) {
  const { row } = route.useSearch()
  const navigate = useNavigate({ from: '/denials/' })
  const ids = worklistOrder(d).map((r) => r.claim.id)
  const select = (id: string) => void navigate({ search: { row: id }, replace: true })
  useListKeys({
    ids,
    selectedId: row,
    onSelect: select,
    onOpen: (id) => void navigate({ to: '/claims/$claimId', params: { claimId: id }, search: { from: 'denials:' } }),
  })
  useEffect(() => {
    if (row) document.querySelector(`[data-row-id="${row}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [row])

  if (d.groups.length === 0) return <EmptyState title="No open denials">New denials land here when an 835 says so.</EmptyState>
  return (
    <table aria-label="Denials worklist" className="w-full table-fixed border-collapse text-base">
      <colgroup>
        <col className="w-[172px]" />
        <col className="w-[148px]" />
        <col />
        <col className="w-[172px]" />
        <col className="w-[132px]" />
      </colgroup>
      <thead className="sticky top-0 z-[1] bg-paper">
        <tr className="text-left text-xs text-soft">
          <th className="h-9 border-b border-line pl-5 font-medium">Deadline</th>
          <th className="border-b border-line font-medium">Whose move</th>
          <th className="border-b border-line font-medium">Claim and reason</th>
          <th className="border-b border-line pr-4 text-right font-medium">Billed</th>
          <th className="border-b border-line pr-5">
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      {d.groups.map((g) => {
        const [head, tail] = splitLabel(g.label)
        return (
          <tbody key={g.next_action} aria-label={g.label} data-next-action={g.next_action}>
            <tr>
              <th colSpan={5} scope="rowgroup" className="border-b border-line px-5 pb-2 pt-4 text-left font-normal">
                <span className="text-base font-semibold">Next: {head}</span>{' '}
                <span className="text-sm text-mid">
                  {tail ? `${tail}. ` : ''}
                  {count(g.count)} claim{g.count === 1 ? '' : 's'}, {money(g.cents)}.
                </span>
              </th>
            </tr>
            {sortedRows(g.rows).map((r) => (
              <Row key={r.claim.id} r={r} today={today} selected={row === r.claim.id} onSelect={() => select(r.claim.id)} />
            ))}
          </tbody>
        )
      })}
    </table>
  )
}

function PayerReason({ d }: { d: DenialsOut }) {
  const user = useCurrentUser()
  const cash = useCash({ enabled: user.role === 'owner' })
  const appeals = cash.data?.appeals_12mo
  const m = d.matrix
  return (
    <aside aria-label="Payer × reason" className="panel self-start px-4 py-3.5 text-sm">
      <h2 className="m-0 text-base font-semibold">Payer × reason</h2>
      <p className="m-0 mb-2 text-xs text-mid">The claims on this worklist, so a pattern shows before it repeats.</p>
      <table aria-label="Payer by reason" className="w-full border-collapse text-xs tabular-nums">
        <thead>
          <tr className="text-soft">
            <th className="py-1 text-left font-medium" />
            {m.columns.map((c) => (
              <th key={c.key} className="px-1 py-1 text-right font-medium">
                {c.label}
              </th>
            ))}
            <th className="px-1 py-1 text-right font-medium">All</th>
          </tr>
        </thead>
        <tbody>
          {m.payers.map((p) => (
            <tr key={p.payer.key} className="border-t border-line">
              <th className="py-1 text-left font-medium">{p.payer.short_name}</th>
              {p.cells.map((c) => (
                <td key={c.reason} className="px-1 text-right">
                  {c.count || ''}
                </td>
              ))}
              <td className="px-1 text-right font-semibold">{p.total}</td>
            </tr>
          ))}
          <tr className="border-t border-line-strong font-semibold">
            <th className="py-1 text-left">All</th>
            {m.totals.map((c) => (
              <td key={c.reason} className="px-1 text-right">
                {c.count || ''}
              </td>
            ))}
            <td className="px-1 text-right">{m.total}</td>
          </tr>
        </tbody>
      </table>
      <p className="m-0 mt-1.5 text-xs text-mid">Max met and alternate benefit are plan limits, not counted{m.excluded ? ` (${m.excluded} here)` : ''}.</p>
      {appeals && (
        <section aria-label="Appeal history" className="mt-3 border-t border-line pt-3">
          <div className="text-xs text-soft">Appeals in the last 12 months</div>
          <b className="text-md font-semibold">
            {appeals.won ?? 0} of {appeals.total ?? 0} won
          </b>
          <div className="text-xs text-mid">
            Reconsideration {appeals.reconsideration_won ?? 0} of {appeals.reconsideration_total ?? 0}, formal {appeals.formal_won ?? 0} of {appeals.formal_total ?? 0}
          </div>
        </section>
      )}
    </aside>
  )
}

export function DenialsPage() {
  const q = useDenials()
  const now = useNow()
  const today = now ? practiceDay(now) : undefined
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <h1 className="sr-only">Denials</h1>
      <Load q={q} what="denials">
        {(d) => (
          <>
            <Summary d={d} />
            <div className="grid gap-3 px-4 pb-4 min-[1400px]:grid-cols-[minmax(0,1fr)_280px]">
              <section aria-label="Worklist" className="panel min-w-0 overflow-hidden pb-1">
                <Worklist d={d} today={today} />
              </section>
              <PayerReason d={d} />
            </div>
          </>
        )}
      </Load>
    </div>
  )
}
