/**
 * Today's claims (mocks Round 5 Part A · 1): built when the visit closes, per-payer files every 30 min, no daily
 * cut-off. Leaving in the next file (editable until it leaves) · Sent today with ack stages · Held with reason,
 * held-since, timely filing and owner · Not billable (listed, not counted). Read-only.
 */
import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { LedgerRow } from '@/api/schema'
import { useLedger } from '@/hooks/useStatic'
import { count, dateTime, money, shortDate, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { SimpleTable } from '@/components/SimpleTable'
import { MoveCell } from '@/components/MoveCell'
import { StatusChip } from '@/components/StatusChip'
import { ackChips, fileGroups, HOLD_REASON, ledgerTotals, type AckChip } from './selectors'

const claimLink = (r: { claim: { id: string; number: number } }) => (
  <Link to="/claims/$claimId" params={{ claimId: r.claim.id }} className="font-semibold">
    #{r.claim.number}
  </Link>
)
const move = { header: 'Whose move', cell: (r: { claim: LedgerRow['claim'] }) => <MoveCell move={r.claim.move} />, className: 'whitespace-nowrap' }
const NW = 'whitespace-nowrap'
const who = (r: { claim: { patient: { display_name: string }; payer: { short_name: string } } }) => (
  <span className="whitespace-nowrap">
    <span className="font-medium">{r.claim.patient.display_name}</span> <span className="text-mid">· {r.claim.payer.short_name}</span>
  </span>
)

function Ack({ chip }: { chip: AckChip }) {
  return <span className={cn('whitespace-nowrap text-sm font-medium', chip.tone === 'ok' ? 'text-ok' : chip.tone === 'bad' ? 'text-risk-ink' : chip.tone === 'pending' ? 'text-mid' : 'text-soft')}>{chip.text}</span>
}

function Section({ title, sub, children, testId }: { title: string; sub?: string; children: ReactNode; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="flex flex-col gap-2">
      <h2 className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-md font-semibold">
        {title}
        {sub && <span className="text-sm font-normal text-mid">{sub}</span>}
      </h2>
      {children}
    </section>
  )
}

function LeavingTable({ rows, date }: { rows: LedgerRow[]; date: string }) {
  return (
    <SimpleTable
      label="Leaving in the next file"
      rows={rows}
      rowKey={(r) => r.claim.id}
      cols={[
        { header: 'Claim', cell: claimLink },
        { header: 'Patient · payer', cell: who },
        { header: 'Procedures', cell: (r) => <span className="text-mid">{r.claim.procedures}</span> },
        { header: 'Billed', cell: (r) => money(r.claim.billed_cents), className: 'text-right tabular-nums' },
        { header: 'Built', cell: (r) => (r.built_at.startsWith(date) ? time(r.built_at) : dateTime(r.built_at)), className: NW },
        { header: 'Checks', cell: (r) => <span className={r.checks_passed === r.checks_total ? 'text-ok' : 'font-medium text-ink'}>{r.checks_passed === r.checks_total ? '✓' : '!'} {r.checks_passed}/{r.checks_total}</span>, className: NW },
        { header: 'Agent text', cell: (r) => (r.agent_text ? <span className="text-agents-ink" title="The narrative is agent-written, so the claim is tier 2">narrative · tier 2</span> : <span className="text-mid" title="PMS codes as-is">none · tier 1</span>), className: NW },
        {
          header: 'Status',
          cell: (r) => (
            <>
              <StatusChip status={r.claim.status} />
              {r.claim.status === 'rejected' && <span className="ml-1.5 whitespace-nowrap text-sm text-mid">fixed, resending</span>}
            </>
          ),
        },
        move,
        { header: 'Editable until', cell: (r) => <span className="font-medium">{time(r.editable_until)}</span>, className: NW },
      ]}
    />
  )
}

export function LedgerPage() {
  const q = useLedger()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Today’s claims" sub="built when the visit closes · per-payer files" />
      <Scroll>
        <Load q={q} what="today’s claims">
          {(d) => {
            const t = ledgerTotals(d)
            const groups = fileGroups(d.leaving_next_file)
            return (
              <div className="flex flex-col gap-6 p-5">
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-line bg-fill px-4 py-2.5 text-base" data-testid="ledger-summary">
                  <span>
                    {shortDate(d.date)} · <b>{count(t.total)} on the ledger</b>
                  </span>
                  <span>
                    Sent today <b>{count(t.sent.count)}</b> · {money(t.sent.cents)}
                  </span>
                  <span className="text-mid">last file {d.last_file_time ? time(d.last_file_time) : '—'}</span>
                  <span>
                    next file <b>{d.next_file_time ? time(d.next_file_time) : '—'}</b>
                  </span>
                  <span>
                    held <b>{count(t.held.count)}</b> · {money(t.held.cents)}
                  </span>
                  <span className="ml-auto text-sm text-mid">Per-payer files every 30 min, 7:45 AM–6:15 PM · no daily cut-off</span>
                </div>

                {groups.length === 0 ? (
                  <Section title="Leaving in the next file · 0" testId="ledger-leaving">
                    <p className="m-0 text-sm text-soft">Nothing is waiting for a file.</p>
                  </Section>
                ) : (
                  groups.map((g) => (
                    <Section
                      key={g.file_time ?? 'none'}
                      testId="ledger-leaving"
                      title={`Leaving in the ${g.file_time ? time(g.file_time) : 'next'} file · ${g.rows.length} · ${money(g.cents)}`}
                      sub="editable until it leaves · no 277CA until then · then void only (freq. 8)"
                    >
                      <LeavingTable rows={g.rows} date={d.date} />
                    </Section>
                  ))
                )}

                <Section title={`Sent today · ${t.sent.count} · ${money(t.sent.cents)}`} sub="999 (file) → Vyne 277CA (minutes) → payer 277CA (usually overnight) · void only (freq. 8)" testId="ledger-sent">
                  {d.sent.length === 0 ? (
                    <p className="m-0 text-sm text-soft">No claims have left today yet.</p>
                  ) : (
                    <SimpleTable
                      label="Sent today"
                      rows={d.sent}
                      rowKey={(r) => r.claim.id}
                      cols={[
                        { header: 'Claim', cell: claimLink },
                        { header: 'Patient · payer', cell: who },
                        { header: 'Procedures', cell: (r) => <span className="text-mid">{r.claim.procedures}</span> },
                        { header: 'Billed', cell: (r) => money(r.claim.billed_cents), className: 'text-right tabular-nums' },
                        { header: 'File', cell: (r) => time(r.file_time), className: NW },
                        { header: '999', cell: (r) => <Ack chip={ackChips(r.acks, true).file} /> },
                        { header: 'Vyne 277CA', cell: (r) => <Ack chip={ackChips(r.acks, true).vyne} /> },
                        { header: 'Payer 277CA', cell: (r) => <Ack chip={ackChips(r.acks, true).payer} /> },
                        { header: 'Status', cell: (r) => <StatusChip status={r.claim.status} /> },
                        move,
                        { header: 'Note', cell: (r) => <span className="text-sm text-mid">{r.note ?? ''}</span>, className: 'min-w-64' },
                      ]}
                    />
                  )}
                </Section>

                <Section title={`Held · ${t.held.count} · ${money(t.held.cents)}`} sub="sorted by days left · a hold cannot be snoozed · alert Dana at 60 d left, Dr. Morgan at 30 d" testId="ledger-held">
                  {d.held.length === 0 ? (
                    <p className="m-0 text-sm text-soft">Nothing is held.</p>
                  ) : (
                    <SimpleTable
                      label="Held"
                      rows={d.held}
                      rowKey={(r) => r.hold.id}
                      rowProps={(r) => ({ 'data-claim-number': String(r.claim.number) })}
                      cols={[
                        { header: 'Claim', cell: claimLink },
                        { header: 'Patient · payer', cell: who },
                        { header: 'Billed', cell: (r) => money(r.claim.billed_cents), className: 'text-right tabular-nums' },
                        {
                          header: 'Reason',
                          cell: (r) => (
                            <span>
                              <span className="font-medium">{HOLD_REASON[r.hold.reason]}</span> <span className="text-mid">· {r.hold.detail}</span>
                            </span>
                          ),
                        },
                        { header: 'Held since', cell: (r) => shortDate(r.hold.held_since), className: NW },
                        {
                          header: 'Timely filing',
                          className: NW,
                          cell: (r) =>
                            r.timely_days_left === null || r.timely_days_left === undefined ? (
                              '—'
                            ) : (
                              <span className={r.timely_days_left <= 30 ? 'font-semibold text-risk-ink' : r.timely_days_left <= 60 ? 'font-semibold' : ''}>
                                {count(r.timely_days_left)} d left
                              </span>
                            ),
                        },
                        move,
                        { header: 'Owner', cell: (r) => r.owner_name ?? '—', className: NW },
                        { header: 'Next step', cell: (r) => <span className="text-sm text-mid">{r.hold.clears_when}</span> },
                      ]}
                    />
                  )}
                </Section>

                <Section title={`Not billable · ${t.notBillable}`} sub="listed, not counted as held · never sent" testId="ledger-not-billable">
                  {d.not_billable.length === 0 ? (
                    <p className="m-0 text-sm text-soft">None today.</p>
                  ) : (
                    <SimpleTable
                      label="Not billable"
                      rows={d.not_billable}
                      rowKey={(r) => `${r.patient.id}:${r.cdt}:${r.quadrant ?? ''}`}
                      cols={[
                        { header: 'Patient', cell: (r) => <span className="font-medium">{r.patient.display_name}</span> },
                        { header: 'Code', cell: (r) => `${r.cdt}${r.quadrant ? ` ${r.quadrant}` : ''}` },
                        { header: 'Fee', cell: (r) => money(r.fee_cents), className: 'text-right' },
                        { header: 'Why', cell: (r) => <span className="text-mid">{r.reason}</span> },
                      ]}
                    />
                  )}
                </Section>
                <p className="m-0 text-sm text-soft">Ack stages: ✓ accepted · A7 rejected, not a denial · pending waiting. Once a file leaves, the only reversal is a void.</p>
              </div>
            )
          }}
        </Load>
      </Scroll>
    </div>
  )
}
