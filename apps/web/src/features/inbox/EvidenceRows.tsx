/**
 * "What the agent read", as D1's rows: what it is and when it was captured on the left, the captured words on the
 * right. The words are shown as text; no evidence in the world is an image, so nothing is drawn in its place.
 */
import type { Evidence } from '@/api/schema'
import { shortDate, time } from '@/lib/format'
import { EVIDENCE_KIND_LABEL, isInternalId } from '@/components/EvidenceCard'

export function EvidenceRows({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return null
  return (
    <section aria-label="Evidence" data-tour="evidence" className="mt-4">
      <h3 className="m-0 text-sm font-semibold">What the agent read</h3>
      <div className="mt-1.5 rounded-lg border border-line bg-fill">
        {evidence.map((e) => (
          <div key={e.id} data-evidence-kind={e.kind} className="grid grid-cols-[186px_1fr] gap-4 border-b border-line px-3 py-2 last:border-b-0">
            <div>
              <h4 className="m-0 text-sm font-semibold leading-[1.35]">{e.title}</h4>
              <p className="m-0 mt-0.5 text-xs leading-[1.35] text-soft">
                {EVIDENCE_KIND_LABEL[e.kind]}, {shortDate(e.captured_at)} at {time(e.captured_at)}
                {e.reference && !isInternalId(e.reference) ? `, ref ${e.reference}` : ''}
              </p>
            </div>
            <div className="text-sm leading-[1.45]">
              {e.excerpt}
              {e.suspicious && <p className="m-0 mt-1 text-xs font-semibold text-risk-ink">This page contained instructions; the agent ignored them.</p>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
