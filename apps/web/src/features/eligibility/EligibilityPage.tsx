/**
 * Eligibility (mocks Round 2 · 4, revised Round 3): the schedule by day with planned work, remaining max and a
 * status pill; selecting a row (`?appt=`, in the URL) opens the benefits card for it. Read-only: the flags that
 * need a person are Inbox items, linked from here.
 */
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { BenefitsPanel, EligibilityRow, EligibilityStatus } from '@/api/schema'
import { useBenefits, useEligibility } from '@/hooks/useStatic'
import { count, longDate, money, plural, shortDate, time, weekday } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { Chip, type ChipTone } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { FlagPill } from '@/components/FlagPill'
import { QueryError } from '@/components/QueryError'
import { SkeletonBlock } from '@/components/ui/Skeleton'
import { byDay, dayLine } from './selectors'

const route = getRouteApi('/eligibility')
/** Green is verified; unverified is dashed (not known yet); "checking" is the agents' hue because they hold it. Red
 * stays for money at risk, and amber (the ⚑) for rows that are the practice's move. */
const STATUS: Record<EligibilityStatus, { label: string; tone: ChipTone; className?: string }> = {
  verified: { label: 'Verified', tone: 'ok' },
  issue: { label: 'Needs attention', tone: 'caution' },
  unverified: { label: 'Not verified', tone: 'dashed' },
  checking: { label: 'Agent checking…', tone: 'neutral', className: '!bg-agents-bg !text-agents-ink' },
}

const planned = (r: { planned: EligibilityRow['planned'] }) => r.planned.map((p) => `${p.cdt}${p.tooth ? ` #${p.tooth}` : ''}`).join(' · ')

function Benefits({ appt }: { appt: string }) {
  const q = useBenefits(appt)
  if (q.isPending) return <SkeletonBlock className="m-3 h-72" />
  if (q.isError) return <QueryError error={q.error} what="benefits" onRetry={() => void q.refetch()} />
  const b: BenefitsPanel = q.data
  const c = b.coverage
  return (
    <aside aria-label={`Benefits · ${b.patient.display_name}`} className="flex flex-col gap-2.5 p-4 text-sm">
      <header>
        <h2 className="m-0 text-md font-semibold">{b.patient.display_name}</h2>
        <div className="text-sm text-mid">
          {c.plan_name} · Group {c.group_no} · ID ••••{c.subscriber_id.slice(-4)} · {c.order}
          {c.self_funded ? ' · self-funded (ERISA)' : ''}
        </div>
        <div className="text-xs text-soft">{b.basis}</div>
      </header>
      <section aria-label="Annual max" className="rounded-lg border border-line px-3 py-2">
        <div className="text-sm text-mid">Annual max</div>
        <div>
          <b className="text-title font-semibold nums-proportional" data-testid="max-left">
            {money(c.remaining_max_cents)}
          </b>{' '}
          <span className="text-mid">
            left of {money(c.annual_max_cents)} · used {money(c.used_cents)}
          </span>
        </div>
        <div className="text-xs text-mid">
          Deductible {money(c.deductible_met_cents)} / {money(c.deductible_cents)} met · Prev {c.pct_preventive}% · Basic {c.pct_basic}% · Major {c.pct_major}%
        </div>
      </section>
      <section aria-label="Frequency limits">
        <h3 className="m-0 mb-1 text-sm font-semibold">Frequency limits</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs font-medium text-soft">
              <th className="py-0.5">Code</th>
              <th>Rule</th>
              <th>Last done</th>
              <th>OK</th>
            </tr>
          </thead>
          <tbody>
            {b.frequencies.map((f) => (
              <tr key={f.cdt} className="border-t border-line">
                <td className="py-1 font-medium">{f.cdt}</td>
                <td>{f.rule}</td>
                <td>{f.last_done ? longDate(f.last_done) : '—'}</td>
                <td className={f.ok_from ? 'font-semibold text-ink' : 'text-ok'}>{f.ok_from ? shortDate(f.ok_from) : 'now'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-label="Planned work" className="rounded-lg border border-line px-3 py-2">
        <div className="flex justify-between">
          <span className="font-semibold">Planned work</span>
          <span className="font-semibold tabular-nums">{money(b.planned_fee_cents)}</span>
        </div>
        <div className="text-sm text-mid">{planned(b)}</div>
        <div className="mt-1 flex justify-between">
          <span>Insurance est.{c.remaining_max_cents < b.planned_fee_cents ? ' (capped by max)' : ''}</span>
          <b data-testid="insurance-est">{money(b.insurance_est_cents ?? null)}</b>
        </div>
        <div className="flex justify-between">
          <span>Patient est.</span>
          <b data-testid="patient-est">{money(b.patient_est_cents ?? null)}</b>
        </div>
      </section>
      {b.agent_note && (
        <section aria-label="Agent note" className="rounded-lg border border-agents-line bg-agents-bg px-3 py-2">
          <div className="text-sm font-semibold text-agents-ink">✦ Agent note</div>
          <p className="m-0">{b.agent_note}</p>
          {b.inbox_item_id && (
            <Link to="/inbox" search={{ item: b.inbox_item_id }} className="mt-1 inline-block text-sm font-semibold">
              Open in Inbox (flag to front desk)
            </Link>
          )}
        </section>
      )}
    </aside>
  )
}

export function EligibilityPage() {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/eligibility' })
  const q = useEligibility({ date: search.date })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Eligibility" sub="verified by agents · re-checked the morning of the visit" />
      <div className="flex min-h-0 flex-1">
        <Scroll className="border-r border-line">
          <Load q={q} what="eligibility">
            {(d) => {
              const days = byDay(d)
              return (
                <div className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-3 border-b border-line bg-fill px-4 py-2 text-sm" data-testid="eligibility-summary">
                    <b className="font-semibold">
                      {days.length ? `${weekday(days[0]?.day ?? d.date)} ${shortDate(days[0]?.day ?? d.date)}${days.length > 1 ? ` – ${weekday(days.at(-1)?.day ?? d.date)} ${shortDate(days.at(-1)?.day ?? d.date)}` : ''}` : shortDate(d.date)} · {plural(d.total, 'appt')}
                    </b>
                    <span className="font-semibold text-practice-ink">⚑ {count(d.need_human)} need a human look</span>
                    <span className="text-sm text-mid">(= the eligibility items in the Inbox)</span>
                    {search.date && (
                      <Link to="/eligibility" search={{ appt: search.appt }} className="ml-auto text-sm">
                        Show the next days
                      </Link>
                    )}
                  </div>
                  {d.total === 0 ? (
                    <EmptyState title="No appointments to verify">Agents re-verify nightly and the morning of the visit.</EmptyState>
                  ) : (
                    <table aria-label="Appointments" className="w-full border-collapse text-base">
                      <thead className="sticky top-0 bg-paper">
                        <tr>
                          {['Time', 'Patient', 'Provider', 'Payer', 'Planned · est. fee', 'Max left', 'Status'].map((h) => (
                            <th key={h} className={cn('h-8 whitespace-nowrap border-b border-line px-2 text-left text-xs font-medium text-soft', h === 'Max left' && 'text-right')}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      {days.map((g) => {
                        return (
                          <tbody key={g.day} aria-label={`${weekday(g.day)} ${shortDate(g.day)}`}>
                            <tr className="bg-fill">
                              <th colSpan={7} scope="rowgroup" className="border-b border-line px-2 py-1.5 text-left text-sm">
                                <button type="button" className="font-semibold text-ink hover:underline" onClick={() => void navigate({ search: (s) => ({ ...s, date: g.day }) })}>
                                  {weekday(g.day)} {shortDate(g.day)}
                                </button>{' '}
                                <span className="font-normal text-mid" data-testid="eligibility-day">· {dayLine(g.tally)}</span>
                              </th>
                            </tr>
                            {g.rows.map((r) => (
                              <tr
                                key={r.appointment_id}
                                data-appt={r.appointment_id}
                                aria-selected={r.appointment_id === search.appt}
                                onClick={() => void navigate({ search: (s) => ({ ...s, appt: r.appointment_id }) })}
                                className={cn('h-10 cursor-pointer border-b border-line [&>td]:py-1.5', r.appointment_id === search.appt ? 'bg-act-bg' : 'hover:bg-hover')}
                              >
                                <td className="whitespace-nowrap px-2">{time(r.start)}</td>
                                <td className="whitespace-nowrap px-2 font-medium">{r.patient.display_name}</td>
                                <td className="whitespace-nowrap px-2 text-mid">{r.provider_name}</td>
                                <td className="px-2">{r.payer?.short_name ?? '—'}</td>
                                <td className="min-w-48 px-2">
                                  <span className="block">{planned(r)}</span>
                                  <span className="block text-sm text-mid">est. fee {money(r.planned_fee_cents)}</span>
                                </td>
                                <td className="px-2 text-right tabular-nums">{money(r.remaining_max_cents)}</td>
                                <td className="px-2">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Chip tone={STATUS[r.status].tone} className={STATUS[r.status].className}>
                                      {STATUS[r.status].label}
                                    </Chip>
                                    {r.inbox_item_id && <FlagPill />}
                                  </span>
                                  {r.note && <span className="block text-sm text-mid">{r.note}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        )
                      })}
                    </table>
                  )}
                </div>
              )
            }}
          </Load>
        </Scroll>
        <div className="w-[380px] flex-none overflow-auto bg-paper">
          {search.appt ? (
            <Benefits appt={search.appt} />
          ) : (
            <EmptyState title="Select an appointment">The benefits card shows the annual max, frequencies and the estimate split for the visit.</EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}
