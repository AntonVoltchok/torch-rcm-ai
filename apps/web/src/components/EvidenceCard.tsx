/**
 * Evidence is a real object captured by a world call (portal page, IVR transcript, 835 line, PMS record,
 * NEA receipt…). Each kind gets its own renderer; none is a placeholder image. Suspicious content (text
 * that tried to instruct the agent) is labelled, never hidden.
 */
import type { ReactNode } from 'react'
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

function PortalThumb({ ev }: { ev: Evidence }) {
  return (
    <div className="relative h-16 overflow-hidden rounded border border-line bg-white" aria-hidden>
      <div className="h-[11px] border-b border-line bg-light" />
      <div className="space-y-1 p-1.5">
        <div className="h-1 w-3/4 rounded bg-[#d4d7db]" />
        <div className={cn('h-1 w-1/2 rounded', /denied|terminated|remaining \$0/i.test(ev.excerpt) ? 'bg-[#e8a39b]' : 'bg-[#d4d7db]')} />
        <div className="h-1 w-2/3 rounded bg-[#d4d7db]" />
      </div>
    </div>
  )
}

function XrayThumb() {
  return (
    <div
      aria-hidden
      className="relative h-16 overflow-hidden rounded border border-[#242a33]"
      style={{ background: 'radial-gradient(ellipse at 50% 45%,#c6ccd2 0,#6d7480 38%,#242a33 78%)' }}
    >
      <div className="absolute left-[38%] top-[14%] h-[70%] w-[24%] rounded-[40%_40%_30%_30%] opacity-85" style={{ background: 'linear-gradient(#e9edf1,#aab2bb)' }} />
    </div>
  )
}

function TextThumb({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <div className={cn('h-16 overflow-hidden rounded border border-line bg-white px-1.5 py-1 text-[10.5px] leading-[1.3] text-mid', mono && 'font-mono')}>{children}</div>
}

function EraThumb({ ev }: { ev: Evidence }) {
  const codes = /(CO|PR|OA)-\d+(?:\s*·\s*[A-Z]\d+)?/.exec(ev.excerpt)?.[0]
  return (
    <TextThumb mono>
      <div className="font-bold text-ink">SVC {codes ?? ''}</div>
      <div>{ev.reference ?? ''}</div>
      <div className="truncate">{/Paid \$[\d,.]+/.exec(ev.excerpt)?.[0] ?? ''}</div>
    </TextThumb>
  )
}

function thumb(ev: Evidence): ReactNode {
  switch (ev.kind) {
    case 'portal_screenshot':
      return <PortalThumb ev={ev} />
    case 'pms_record':
      return /x-ray|PA |periapical|imaging/i.test(`${ev.title} ${ev.excerpt}`) ? <XrayThumb /> : <TextThumb>{ev.excerpt}</TextThumb>
    case 'era_line':
      return <EraThumb ev={ev} />
    case 'ivr_transcript':
    case 'rep_call':
      return (
        <TextThumb>
          <b className="text-acc">{ev.kind === 'rep_call' ? 'Rep' : 'IVR'}:</b> {ev.excerpt}
        </TextThumb>
      )
    case 'nea_attachment':
      return (
        <TextThumb mono>
          <div className="font-bold text-ink">NEA# {ev.reference ?? '—'}</div>
          <div>FastAttach · accepted</div>
        </TextThumb>
      )
    default:
      return <TextThumb>{ev.excerpt}</TextThumb>
  }
}

export function EvidenceCard({ evidence, className }: { evidence: Evidence; className?: string }) {
  return (
    <figure data-evidence-kind={evidence.kind} className={cn('m-0 min-w-0 flex-1 rounded-[7px] border border-line bg-white p-[7px]', className)}>
      {thumb(evidence)}
      <figcaption className="mt-1.5 text-xs leading-[1.3]">
        <b className="block truncate" title={evidence.title}>
          {evidence.title}
        </b>
        <span className="text-mid">
          {KIND_LABEL[evidence.kind]} · {dateTime(evidence.captured_at)}
          {evidence.reference ? ` · ${evidence.reference}` : ''}
        </span>
        {evidence.suspicious && <span className="mt-0.5 block font-semibold text-warn">This page contained instructions; they were ignored.</span>}
      </figcaption>
    </figure>
  )
}

/** Full-text view for the detail pane under the thumbnails. */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="text-sm text-soft">No evidence attached.</p>
  return (
    <div className="flex gap-2.5">
      {evidence.map((e) => (
        <EvidenceCard key={e.id} evidence={e} />
      ))}
    </div>
  )
}
