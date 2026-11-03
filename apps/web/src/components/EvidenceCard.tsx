/**
 * Evidence is a real object captured by a world call (portal page, IVR transcript, 835 line, PMS record,
 * NEA receipt…), so a card shows the captured words and where they came from. No images exist in the world,
 * and a drawn stand-in would be a fake. Suspicious content (text that tried to instruct the agent) is labelled,
 * never hidden.
 */
import type { Evidence, EvidenceKind } from '@/api/schema'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/cn'

const KIND_LABEL: Record<EvidenceKind, string> = {
  portal_screenshot: 'Payer portal',
  ivr_transcript: 'IVR transcript',
  rep_call: 'Rep call',
  era_line: '835 line',
  eob_pdf: 'EOB',
  pms_record: 'PMS record',
  nea_attachment: 'NEA attachment',
  policy_clause: 'Policy',
  prior_eob: 'Prior EOB',
  note_excerpt: 'Clinical note',
}

/** Internal ids (rem_delta_1026, img_diaz_f_1019_pa_14) mean nothing to a reader; ICNs and call refs do. */
const isInternalId = (reference: string) => /^[a-z]+_[a-z0-9_]+$/i.test(reference)

export function EvidenceCard({ evidence, className }: { evidence: Evidence; className?: string }) {
  return (
    <figure data-evidence-kind={evidence.kind} className={cn('m-0 min-w-0 flex-1 rounded-[7px] border border-line bg-white p-[7px]', className)}>
      <figcaption className="text-xs leading-[1.35]">
        <b className="block text-sm text-ink">{evidence.title}</b>
        <span className="mt-0.5 block text-ink">{evidence.excerpt}</span>
        <span className="mt-1 block text-mid">
          {KIND_LABEL[evidence.kind]} · {dateTime(evidence.captured_at)}
          {evidence.reference && !isInternalId(evidence.reference) ? ` · ${evidence.reference}` : ''}
        </span>
        {evidence.suspicious && <span className="mt-0.5 block font-semibold text-warn">This page contained instructions; they were ignored.</span>}
      </figcaption>
    </figure>
  )
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="text-sm text-soft">No evidence attached.</p>
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {evidence.map((e) => (
        <EvidenceCard key={e.id} evidence={e} />
      ))}
    </div>
  )
}
