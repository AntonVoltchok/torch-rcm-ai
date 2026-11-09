import type { MoneyMath as Money } from '@/api/schema'
import { money as fmt } from '@/lib/format'
import { cn } from '@/lib/cn'

const minus = (cents: number | null) => (cents === null ? null : -cents)

// Once an 835 is final the API sends the estimate equal to the patient responsibility, so a difference means estimate.
export const moneyIsEstimate = (money: Money) => money.patient_est_cents !== money.patient_resp_cents

/** billed → allowed → paid / write-off / patient, all from server cents; "—" where the payer hasn't said. */
export function MoneyMath({ money, className }: { money: Money; className?: string }) {
  const estimate = moneyIsEstimate(money)
  const est = estimate ? 'est.' : undefined
  const cells: [string, number | null, string?][] = [
    ['Billed', money.billed_cents],
    ['Allowed', money.allowed_cents, est],
    ['Contractual w/o', minus(money.contractual_cents), est],
    ['Write-off', minus(money.writeoff_cents)],
    ['Paid', money.paid_cents],
    ['Patient', estimate ? money.patient_est_cents : money.patient_resp_cents, est],
  ]
  return (
    <dl className={cn('m-0 flex gap-0 overflow-hidden rounded-lg border border-line bg-paper', className)} title={money.basis}>
      {cells.map(([label, cents, note]) => (
        <div key={label} className="min-w-0 flex-1 border-l border-line px-3 py-2 first:border-l-0">
          <dt className="text-xs text-soft">
            {label}
            {note ? <span className="text-soft"> · {note}</span> : null}
          </dt>
          <dd className="m-0 text-md font-semibold">{fmt(cents)}</dd>
        </div>
      ))}
    </dl>
  )
}
