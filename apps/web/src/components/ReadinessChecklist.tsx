import type { ReadinessCheck } from '@/api/schema'
import { cn } from '@/lib/cn'

const ICON = { pass: '✓', warn: '!', fail: '✕', na: '–' } as const
const TONE = { pass: 'text-ok', warn: 'text-ink', fail: 'text-risk-ink', na: 'text-soft' } as const
const LABEL: Record<ReadinessCheck['key'], string> = {
  note_signed: 'Note signed',
  procs_match_note: 'Procedures match note',
  fee_schedule: 'Fee schedule',
  subscriber_id_format: 'Subscriber id format',
  eligibility_fresh: 'Eligibility fresh',
  remaining_max: 'Remaining max',
  frequency: 'Frequency',
  tooth_validity: 'Tooth validity',
  attachment_rule: 'Attachment rule',
  narrative: 'Narrative',
  cob_order: 'COB order',
  duplicate: 'Duplicate check',
  timely_filing: 'Timely filing',
}

/** Named readiness checks (not "scrub: 0 errors"). */
export function ReadinessChecklist({ checks }: { checks: ReadinessCheck[] }) {
  if (checks.length === 0) return <p className="text-sm text-soft">No readiness checks recorded.</p>
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-x-4 gap-y-0.5 p-0 text-sm">
      {checks.map((c) => (
        <li key={c.key} className="flex min-w-0 gap-1.5" title={c.detail}>
          <span className={cn('w-3 flex-none text-center font-bold', TONE[c.status])} aria-label={c.status}>
            {ICON[c.status]}
          </span>
          <span className="flex-none font-medium">{LABEL[c.key]}</span>
          <span className="truncate text-mid">{c.detail}</span>
        </li>
      ))}
    </ul>
  )
}
