import type { MoneyMath as Money } from '@/api/schema'
import { money as fmt } from '@/lib/format'
import { cn } from '@/lib/cn'

/** billed → allowed → paid / patient, all from server cents; "—" where the payer hasn't said. Estimates say so. */
export function MoneyMath({ money, className }: { money: Money; className?: string }) {
  // The API fills the estimate fields from the 835 once there is one, so they read right before and after it.
  const estimate = money.basis !== 'per 835'
  const cells: [string, number | null, string?][] = [
    ['Billed', money.billed_cents],
    ['Allowed', money.allowed_cents],
    ['Contractual w/o', money.contractual_cents === null ? null : -money.contractual_cents],
    ['Paid', money.paid_cents],
    ['Patient', money.patient_est_cents, estimate ? 'est.' : undefined],
  ]
  return (
    <dl className={cn('m-0 flex gap-0 overflow-hidden rounded-lg border border-line', className)} title={money.basis}>
      {cells.map(([label, cents, note]) => (
        <div key={label} className="min-w-0 flex-1 border-l border-light px-3 py-1.5 first:border-l-0">
          <dt className="text-xs text-mid">
            {label}
            {note ? <span className="text-soft"> · {note}</span> : null}
          </dt>
          <dd className="m-0 text-[17px] font-bold">{fmt(cents)}</dd>
        </div>
      ))}
    </dl>
  )
}
