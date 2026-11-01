import type { ClaimDetail } from '@/api/schema'
import { money } from '@/lib/format'
import { cn } from '@/lib/cn'

type Money = Pick<ClaimDetail, 'billed_cents' | 'allowed_cents' | 'paid_cents' | 'writeoff_cents' | 'patient_resp_cents'>

/** billed → allowed → paid / write-off / patient, all from server cents; "—" where the payer hasn't said. */
export function MoneyMath({ claim, className }: { claim: Money; className?: string }) {
  const cells: [string, number | null | undefined, string?][] = [
    ['Billed', claim.billed_cents],
    ['Allowed', claim.allowed_cents],
    ['Contractual w/o', claim.writeoff_cents === null || claim.writeoff_cents === undefined ? null : -claim.writeoff_cents],
    ['Paid', claim.paid_cents],
    ['Patient', claim.patient_resp_cents, claim.paid_cents === 0 ? 'est.' : undefined],
  ]
  return (
    <dl className={cn('m-0 flex gap-0 overflow-hidden rounded-lg border border-line', className)}>
      {cells.map(([label, cents, note]) => (
        <div key={label} className="min-w-0 flex-1 border-l border-light px-3 py-1.5 first:border-l-0">
          <dt className="text-xs text-mid">
            {label}
            {note ? <span className="text-soft"> · {note}</span> : null}
          </dt>
          <dd className="m-0 text-[17px] font-bold">{money(cents ?? null)}</dd>
        </div>
      ))}
    </dl>
  )
}
