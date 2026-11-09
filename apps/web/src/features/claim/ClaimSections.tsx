/** The claim's cards below the header (D1): denial decoded, money, lines, attachments and acknowledgments. */
import type { ReactNode } from 'react'
import type { AckEvent, Attachment, ClaimDetail, ClaimLine, MoneyMath } from '@/api/schema'
import { moneyIsEstimate } from '@/components/MoneyMath'
import { cdtName } from '@/lib/cdt'
import { money, shortDate, time } from '@/lib/format'
import { cn } from '@/lib/cn'

export function Card({ title, children, className, label }: { title: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section aria-label={label ?? (typeof title === 'string' ? title : undefined)} className={cn('panel min-w-0 px-4 py-3.5', className)}>
      <h2 className="m-0 mb-1.5 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

/** "CO-16" with its plain meaning on hover and for screen readers. */
export function Code({ code, meaning }: { code: string; meaning?: string | undefined }) {
  return (
    <abbr title={meaning} className="cursor-help underline decoration-soft decoration-dotted underline-offset-[3px]">
      {code}
    </abbr>
  )
}

export function DenialCard({ d }: { d: ClaimDetail }) {
  const denial = d.denial
  if (!denial) return null
  const rootEntry = d.timeline.findLast((e) => e.kind === 'root_cause')
  const why = rootEntry?.title.replace(/^Root cause:\s*(ours|payer|patient|unknown)\s*[—:-]\s*/i, '')
  return (
    <Card
      label="Denial"
      title={
        <>
          Denied <Code code={denial.carc} meaning={denial.decoded} />
          {denial.rarc && (
            <>
              {' '}
              <Code code={denial.rarc} meaning={denial.decoded} />
            </>
          )}
        </>
      }
    >
      <p className="m-0 text-sm text-ink">{denial.decoded}.</p>
      {denial.root_cause === 'ours' ? (
        <p className="m-0 mt-2 rounded-[7px] border border-risk-line bg-risk-bg px-2.5 py-1.5 text-sm text-risk-ink" data-root-cause="ours">
          <b>Root cause: ours.</b>
          {why ? ` ${why.charAt(0).toUpperCase()}${why.slice(1)}.` : ' The practice sent something the payer’s rule does not accept.'}
        </p>
      ) : (
        <p className="m-0 mt-2 text-sm text-mid" data-root-cause={denial.root_cause}>
          Root cause: {denial.root_cause}.
        </p>
      )}
      {d.deadline.basis && <p className="m-0 mt-2 text-xs text-soft">{d.deadline.basis}</p>}
    </Card>
  )
}

/**
 * Money (D1, with the red team's two columns). While the payer hasn't settled the patient share, the contract's
 * Expected figures sit beside what the 835 said, and the group code says who can be billed. "estimate" is the
 * server's rule: the estimate differs from the 835's patient responsibility (`moneyIsEstimate`).
 */
export function MoneyCard({ m, plan, payer, denial }: { m: MoneyMath; plan: string; payer: string; denial: ClaimDetail['denial'] }) {
  const est = moneyIsEstimate(m)
  const neg = (c: number | null) => (c === null ? null : -c)
  const rows: [string, number | null, number | null][] = est
    ? [
        ['Billed', m.billed_cents, m.billed_cents],
        ['Allowed', m.allowed_cents, null],
        ['Contractual', neg(m.contractual_cents), null],
        ['Insurance', m.insurance_est_cents, m.paid_cents],
        ['Patient', m.patient_est_cents, m.patient_resp_cents],
      ]
    : [
        ['Billed', m.billed_cents, null],
        ['Allowed', m.allowed_cents, null],
        ['Contractual', neg(m.contractual_cents), null],
        ...(m.writeoff_cents ? ([['Write-off', -m.writeoff_cents, null]] as [string, number, null][]) : []),
        ['Paid', m.paid_cents, null],
        ['Patient', m.patient_resp_cents, null],
      ]
  const co = denial && !denial.carc.startsWith('PR-') && m.patient_resp_cents === 0
  return (
    <Card title="Money">
      <table className="w-full border-collapse text-sm" title={m.basis}>
        {est && (
          <thead>
            <tr className="text-xs text-soft">
              <th className="py-1 text-left font-medium" />
              <th className="py-1 text-right font-medium">Expected, estimate</th>
              <th className="py-1 pl-3 text-right font-medium">Per the 835</th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label} className="border-t border-line first:border-t-0">
              <th scope="row" className="py-1.5 text-left font-normal text-mid">
                {label}
              </th>
              <td className="py-1.5 text-right font-medium tabular-nums">{money(a)}</td>
              {est && <td className="py-1.5 pl-3 text-right font-medium tabular-nums">{b === null ? <span className="font-normal text-soft">—</span> : money(b)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {co && (
        <p className="m-0 mt-2 text-sm font-medium text-ink" data-testid="patient-billable">
          Patient cannot be billed ({denial.carc.slice(0, 2)}): the 835 puts $0 on the patient.
        </p>
      )}
      <p className="m-0 mt-1.5 text-xs text-soft">
        {est ? `Expected figures are estimates from the contract, ${plan}. ${payer} has not agreed them.` : 'From the 835.'}
      </p>
    </Card>
  )
}

export function LinesTable({ lines, estimate }: { lines: ClaimLine[]; estimate: boolean }) {
  const th = 'py-1.5 pr-2 text-left text-xs font-medium text-soft'
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className={th}>Procedure</th>
          <th className={th}>Tooth</th>
          <th className={cn(th, 'text-right')}>Billed</th>
          <th className={cn(th, 'text-right')}>{estimate ? 'Allowed est.' : 'Allowed'}</th>
          <th className={cn(th, 'text-right')}>Paid</th>
          <th className={cn(th, 'pl-4')}>Adjustments</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-t border-line align-top">
            <td className="py-1.5 pr-2">
              {cdtName(l.cdt) ?? l.cdt} <span className="text-soft">{l.cdt}</span>
            </td>
            <td className="py-1.5 pr-2">{l.tooth ?? '—'}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.fee_cents)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.allowed_cents ?? null)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.paid_cents ?? null)}</td>
            <td className="py-1.5 pl-4 text-mid">{l.adj?.length ? l.adj.map((a) => `${a.group}-${a.code} ${money(a.cents)}`).join(', ') : 'None'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const ATT_LABEL: Record<Attachment['kind'], string> = { pa: 'PA x-ray', bwx: 'BWX', fmx: 'FMX', perio_chart: 'Perio chart', narrative: 'Narrative', eob: 'EOB / 835' }

export function AttachmentsAndAcks({ attachments, acks }: { attachments: Attachment[]; acks: AckEvent[] }) {
  return (
    <div className="grid grid-cols-2 gap-6 text-sm">
      <section aria-label="Attachments">
        <h3 className="m-0 mb-1 text-xs font-medium text-soft">Attachments</h3>
        {attachments.length === 0 ? (
          <p className="m-0 text-mid">None sent.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {attachments.map((a) => (
              <li key={a.id} className="py-0.5">
                <b className="font-semibold">{ATT_LABEL[a.kind]}</b> {[a.note, a.nea_number ? `NEA# ${a.nea_number}` : null, shortDate(a.created_at)].filter(Boolean).join(', ')}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Acknowledgements">
        <h3 className="m-0 mb-1 text-xs font-medium text-soft">Acknowledgments</h3>
        {acks.length === 0 ? (
          <p className="m-0 text-mid">Not sent yet.</p>
        ) : (
          <ol className="m-0 list-none p-0">
            {acks.map((a) => (
              <li key={a.id} className={cn('py-0.5', /a7|reject/.test(a.stage) && 'text-risk-ink')}>
                {a.message}, <span className="text-mid">{shortDate(a.at)} at {time(a.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
