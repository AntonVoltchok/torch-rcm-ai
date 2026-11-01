/**
 * Denials (mocks Round 6 Part A · 1): the worklist grouped by next action, path chip + tier per row, typed
 * deadlines, "if we lose", the ours/theirs tag; the payer × reason matrix in the sidebar. Rows open the claim;
 * formal-appeal rows also link the (mock-only) appeal workbench.
 */
import { Link } from '@tanstack/react-router'
import { useDenials, useCash } from '@/hooks/useStatic'
import { useNow } from '@/hooks/useClock'
import { count, money, practiceDay, shortDate } from '@/lib/format'
import { AGENT_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { EmptyState } from '@/components/EmptyState'
import { Chip } from '@/components/Chip'
import { TierBadge } from '@/components/TierBadge'
import { deadlineLabel, ifWeLose, PATH, pathTier, payerReasonMatrix, REASONS, tag } from './selectors'

const COLS = ['Claim · payer', 'CARC · RARC', 'At stake', 'Deadline (typed)', 'If we lose', 'Path · tier', 'Tag', 'Owner'] as const

export function DenialsPage() {
  const q = useDenials()
  const now = useNow()
  const user = useCurrentUser()
  const cash = useCash({ enabled: user.role === 'owner' })
  const today = now ? practiceDay(now) : undefined
  const appeals = cash.data?.appeals_12mo
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Denials" sub="worklist · grouped by what happens next" />
      <Load q={q} what="denials">
        {(d) => {
          const rows = d.groups.flatMap((g) => g.rows)
          const m = payerReasonMatrix(rows)
          return (
            <div className="flex min-h-0 flex-1">
              <Scroll className="border-r border-line">
                <div className="flex flex-wrap items-center gap-3 border-b border-line bg-fill px-4 py-2 text-sm" data-testid="denials-summary">
                  <b>Next action {count(d.total)}</b>
                  <span>In flight {count(d.in_flight.length)}</span>
                  <span className="text-xs text-mid">Counts tie to the strip’s Denied tile · the path comes from the 835 group code and RARC, not from whose fault it was</span>
                </div>
                {d.groups.length === 0 ? (
                  <EmptyState title="No open denials">New denials land here when an 835 says so.</EmptyState>
                ) : (
                  <table aria-label="Denials worklist" className="w-full border-collapse text-base">
                    <thead className="sticky top-0 z-[1] bg-fill">
                      <tr>
                        {COLS.map((c) => (
                          <th key={c} className="h-8 border-b border-line px-2 text-left text-2xs font-extrabold uppercase tracking-[.05em] text-soft">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    {d.groups.map((g) => (
                      <tbody key={g.next_action} aria-label={g.label} data-next-action={g.next_action}>
                        <tr className="bg-fill">
                          <th colSpan={COLS.length} scope="rowgroup" className="border-b border-line px-2 py-1.5 text-left">
                            <span className="text-sm font-bold">{g.label}</span>{' '}
                            <span className="text-xs font-normal text-mid">
                              · {count(g.count)} claim{g.count === 1 ? '' : 's'} · {money(g.cents)}
                            </span>
                          </th>
                        </tr>
                        {g.rows.map((r) => {
                          const dl = today ? deadlineLabel(r, today) : { text: '—', days: null }
                          return (
                            <tr key={r.claim.id} data-claim-number={r.claim.number} className="border-b border-light align-top">
                              <td className="px-2 py-1.5">
                                <Link to="/claims/$claimId" params={{ claimId: r.claim.id }} className="font-semibold">
                                  #{r.claim.number}
                                </Link>{' '}
                                <span className="text-mid">· {r.claim.payer.short_name}</span>
                                <div className="text-xs text-mid">
                                  {r.claim.patient.display_name} · {r.claim.procedures}
                                </div>
                                {r.claim.in_flight && <div className="text-xs font-semibold text-acc">✦ {r.claim.in_flight}</div>}
                              </td>
                              <td className="px-2 py-1.5">
                                <b>
                                  {r.carc}
                                  {r.rarc ? ` · ${r.rarc}` : ''}
                                </b>
                                <div className="text-xs text-mid">{r.decoded}</div>
                              </td>
                              <td className="px-2 py-1.5 text-right">{money(r.claim.billed_cents)}</td>
                              <td className="px-2 py-1.5">
                                <span className={cn('font-semibold', dl.days !== null && dl.days <= 30 && 'text-bad')}>{dl.text}</span>
                                <div className="text-xs text-mid">
                                  {r.deadline.due_on ? `${shortDate(r.deadline.due_on)} · ` : ''}
                                  {r.deadline.basis}
                                  {r.erisa ? ' · ERISA plan' : ''}
                                </div>
                              </td>
                              <td className={cn('px-2 py-1.5 text-sm', r.patient_billable_if_lost ? 'text-mid' : 'font-semibold')}>{ifWeLose(r)}</td>
                              <td className="px-2 py-1.5">
                                <span className="inline-flex items-center gap-1">
                                  <Chip tone={r.next_action === 'formal_appeal' ? 'ink' : 'neutral'}>{PATH[r.next_action].label}</Chip>
                                  <TierBadge tier={pathTier(r)} compact />
                                </span>
                                {r.next_action === 'formal_appeal' && (
                                  <div>
                                    <Link to="/denials/$claimId" params={{ claimId: r.claim.id }} className="text-xs font-semibold">
                                      Appeal workbench →
                                    </Link>
                                  </div>
                                )}
                                {r.next_action === 'bill_patient_link' && (
                                  <div>
                                    <Link to="/payments" className="text-xs font-semibold">
                                      closes in Payments →
                                    </Link>
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                <Chip tone={tag(r) === 'ours' ? 'bad' : 'neutral'}>{tag(r)}</Chip>
                              </td>
                              <td className="px-2 py-1.5 text-sm">
                                {r.signer ? <b>{r.signer} signs</b> : <span className="font-semibold text-acc">✦ {AGENT_NAME[r.agent]}</span>}
                                {r.checklist.length > 0 && (
                                  <ul className="m-0 list-disc pl-4 text-xs text-mid">
                                    {r.checklist.map((c) => (
                                      <li key={c}>{c}</li>
                                    ))}
                                  </ul>
                                )}
                                {r.inbox_item_id && (
                                  <Link to="/inbox" search={{ item: r.inbox_item_id }} className="text-xs">
                                    open item →
                                  </Link>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    ))}
                  </table>
                )}
              </Scroll>
              <aside aria-label="Payer × reason" className="w-[300px] flex-none overflow-auto p-4 text-sm">
                <h2 className="m-0 mb-1 text-sm font-bold">Payer × reason</h2>
                <p className="m-0 mb-2 text-xs text-mid">the claims on this worklist</p>
                <table aria-label="Payer by reason" className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="text-soft">
                      <th className="text-left" />
                      {REASONS.map((r) => (
                        <th key={r} className="px-1 text-right font-semibold">
                          {r}
                        </th>
                      ))}
                      <th className="px-1 text-right">Σ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.payers.map((p) => (
                      <tr key={p.key} className="border-t border-light">
                        <th className="py-0.5 text-left font-semibold">{p.name}</th>
                        {REASONS.map((r) => (
                          <td key={r} className="px-1 text-right">
                            {p.cells[r] ?? ''}
                          </td>
                        ))}
                        <td className="px-1 text-right font-bold">{p.total}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line font-bold">
                      <th className="py-0.5 text-left">All</th>
                      {REASONS.map((r) => (
                        <td key={r} className="px-1 text-right">
                          {m.totals[r] ?? ''}
                        </td>
                      ))}
                      <td className="px-1 text-right">{m.total}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-1 text-xs text-mid">Max met and alternate benefits are plan limits, not counted{m.excluded ? ` (${m.excluded} here)` : ''}.</p>
                {appeals && (
                  <section aria-label="Appeal history" className="mt-3 rounded-md border border-line p-2">
                    <div className="text-xs text-mid">Appeal history · 12 mo</div>
                    <b>
                      {appeals.won ?? 0} of {appeals.total ?? 0} won
                    </b>
                    <div className="text-xs text-mid">
                      reconsid. {appeals.reconsideration_won ?? 0} of {appeals.reconsideration_total ?? 0} · formal {appeals.formal_won ?? 0} of {appeals.formal_total ?? 0}
                    </div>
                  </section>
                )}
              </aside>
            </div>
          )
        }}
      </Load>
    </div>
  )
}
