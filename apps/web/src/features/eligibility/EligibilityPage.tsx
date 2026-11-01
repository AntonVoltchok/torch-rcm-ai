/**
 * Eligibility (mocks Round 2 · 4, revised Round 3): the schedule by day with planned work, remaining max and a
 * status pill; selecting a row (`?appt=`, in the URL) opens the benefits card for it. Read-only: the flags that
 * need a person are Inbox items, linked from here.
 */
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { BenefitsPanel, EligibilityRow, EligibilityStatus } from '@/api/schema'
import { useBenefits, useEligibility } from '@/hooks/useStatic'
import { count, longDate, money, practiceDay, shortDate, time, weekday } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { Chip, type ChipTone } from '@/components/Chip'
import { EmptyState } from '@/components/EmptyState'
import { QueryError } from '@/components/QueryError'
import { SkeletonBlock } from '@/components/ui/Skeleton'

const route = getRouteApi('/eligibility')
const STATUS: Record<EligibilityStatus, { label: string; tone: ChipTone }> = {
  verified: { label: 'Verified', tone: 'ok' },
  issue: { label: 'Issue', tone: 'warn' },
  unverified: { label: 'Unverified', tone: 'bad' },
  checking: { label: 'Agent checking…', tone: 'acc' },
}

export function byDay(rows: EligibilityRow[]): { day: string; rows: EligibilityRow[] }[] {
  const out: { day: string; rows: EligibilityRow[] }[] = []
  for (const r of [...rows].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = practiceDay(r.start)
    const last = out.at(-1)
    if (last?.day === day) last.rows.push(r)
    else out.push({ day, rows: [r] })
  }
  return out
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
        <h2 className="m-0 text-[17px] font-bold">{b.patient.display_name}</h2>
        <div className="text-xs text-mid">
          {c.plan_name} · Group {c.group_no} · ID ••••{c.subscriber_id.slice(-4)} · {c.order}
          {c.self_funded ? ' · self-funded (ERISA)' : ''}
        </div>
        <div className="text-xs text-soft">{b.basis}</div>
      </header>
      <section aria-label="Annual max" className="rounded-lg border border-line px-3 py-2">
        <div className="text-xs text-mid">Annual max</div>
        <div>
          <b className="text-[20px] font-extrabold" data-testid="max-left">
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
        <h3 className="m-0 mb-1 text-xs font-bold uppercase tracking-[.05em] text-soft">Frequency limits</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-2xs uppercase text-soft">
              <th className="py-0.5">Code</th>
              <th>Rule</th>
              <th>Last done</th>
              <th>OK</th>
            </tr>
          </thead>
          <tbody>
            {b.frequencies.map((f) => (
              <tr key={f.cdt} className="border-t border-light">
                <td className="py-0.5 font-semibold">{f.cdt}</td>
                <td>{f.rule}</td>
                <td>{f.last_done ? longDate(f.last_done) : '—'}</td>
                <td className={f.ok_from ? 'font-semibold text-warn' : 'text-ok'}>{f.ok_from ? shortDate(f.ok_from) : 'now'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section aria-label="Planned work" className="rounded-lg border border-line px-3 py-2">
        <div className="flex justify-between">
          <b>Planned work</b>
          <b>{money(b.planned_fee_cents)}</b>
        </div>
        <div className="text-xs text-mid">{planned(b)}</div>
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
        <section aria-label="Agent note" className="rounded-lg border border-acc-line bg-acc-bg px-3 py-2">
          <div className="text-2xs font-extrabold uppercase tracking-[.06em] text-acc">✦ Agent note</div>
          <p className="m-0">{b.agent_note}</p>
          {b.inbox_item_id && (
            <Link to="/inbox" search={{ item: b.inbox_item_id }} className="mt-1 inline-block text-sm font-semibold">
              Open in Inbox → (flag to front desk)
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
              const days = byDay(d.rows)
              return (
                <div className="flex flex-col">
                  <div className="flex flex-wrap items-center gap-3 border-b border-line bg-fill px-4 py-2 text-sm" data-testid="eligibility-summary">
                    <b>
                      {days.length ? days.map((g) => `${weekday(g.day)} ${shortDate(g.day)}`).join(' – ') : shortDate(d.date)} · {count(d.rows.length)} appts
                    </b>
                    <span className="font-semibold text-bad">⚑ {count(d.need_human)} need a human look</span>
                    <span className="text-xs text-mid">(= the eligibility items in the Inbox)</span>
                    {search.date && (
                      <Link to="/eligibility" search={{ appt: search.appt }} className="ml-auto text-xs">
                        Show the next days
                      </Link>
                    )}
                  </div>
                  {days.length === 0 ? (
                    <EmptyState title="No appointments to verify">Agents re-verify nightly and the morning of the visit.</EmptyState>
                  ) : (
                    <table aria-label="Appointments" className="w-full border-collapse text-base">
                      <thead className="sticky top-0 bg-fill">
                        <tr>
                          {['Time', 'Patient', 'Provider', 'Payer', 'Planned · est. fee', 'Max left', 'Status'].map((h) => (
                            <th key={h} className="h-8 border-b border-line px-2 text-left text-2xs font-extrabold uppercase tracking-[.05em] text-soft">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      {days.map((g) => {
                        const tally = (s: EligibilityStatus) => g.rows.filter((r) => r.status === s).length
                        return (
                          <tbody key={g.day} aria-label={`${weekday(g.day)} ${shortDate(g.day)}`}>
                            <tr className="bg-fill">
                              <th colSpan={7} scope="rowgroup" className="border-b border-line px-2 py-1 text-left text-xs">
                                <button type="button" className="font-bold text-ink hover:underline" onClick={() => void navigate({ search: (s) => ({ ...s, date: g.day }) })}>
                                  {weekday(g.day)} {shortDate(g.day)}
                                </button>{' '}
                                <span className="font-normal text-mid">
                                  · {g.rows.length} appts · {tally('verified')} verified · {tally('issue')} issues · {tally('unverified')} unverified · {tally('checking')} checking
                                </span>
                              </th>
                            </tr>
                            {g.rows.map((r) => (
                              <tr
                                key={r.appointment_id}
                                data-appt={r.appointment_id}
                                aria-selected={r.appointment_id === search.appt}
                                onClick={() => void navigate({ search: (s) => ({ ...s, appt: r.appointment_id }) })}
                                className={cn('h-10 cursor-pointer border-b border-light hover:bg-fill', r.appointment_id === search.appt && 'bg-acc-bg')}
                              >
                                <td className="px-2">{time(r.start)}</td>
                                <td className="px-2">
                                  <b>{r.patient.display_name}</b>
                                </td>
                                <td className="px-2 text-mid">{r.provider_name}</td>
                                <td className="px-2">{r.payer?.short_name ?? '—'}</td>
                                <td className="px-2">
                                  <span>{planned(r)}</span> <span className="text-xs text-mid">est. fee {money(r.planned_fee_cents)}</span>
                                </td>
                                <td className="px-2 text-right">{money(r.remaining_max_cents)}</td>
                                <td className="px-2">
                                  <Chip tone={STATUS[r.status].tone}>
                                    {STATUS[r.status].label}
                                    {r.note ? ` · ${r.note}` : ''}
                                    {r.inbox_item_id ? ' ⚑' : ''}
                                  </Chip>
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
        <div className="w-[380px] flex-none overflow-auto bg-white">
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
