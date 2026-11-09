/**
 * The claim's story, newest last. Each entry carries its party's mark (D1: practice pill, agents block, payer leaf;
 * system is grey). The party is the server's `who` when sent, else the lane. Agent errors are owned.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Evidence, MoveWho, RunViewEvidence, TimelineEntry } from '@/api/schema'
import { runQueryOptions } from '@/hooks/useRun'
import { dateTime, plural } from '@/lib/format'
import { BatonLegend, PartyMark } from './Baton'
import { SkeletonBlock } from './ui/Skeleton'
import { EvidenceCard } from './EvidenceCard'
import { QueryError } from './QueryError'

const LANE_PARTY: Record<TimelineEntry['lane'], MoveWho> = { agent: 'agents', payer: 'payer', system: 'nobody', human: 'practice' }

const isHydrated = (e: RunViewEvidence): e is Evidence => e.excerpt !== undefined
const EVIDENCE_LABEL = (n: number) => plural(n, 'evidence item')

/** The timeline carries evidence ids; the run holds the objects, fetched when someone asks (no N+1 on the claim). */
function RunEvidence({ runId, ids }: { runId: string; ids: string[] }) {
  const [open, setOpen] = useState(false)
  const run = useQuery({ ...runQueryOptions(runId), enabled: open })
  const evidence = (run.data?.evidence ?? []).filter(isHydrated).filter((e) => ids.includes(e.id))
  return (
    <div className="mt-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-xs font-medium text-act hover:underline">
        {open ? '▾' : '▸'} {EVIDENCE_LABEL(ids.length)}
      </button>
      {open && run.isPending && <SkeletonBlock className="mt-1 h-16 max-w-[180px]" />}
      {open && run.isError && <QueryError error={run.error} what="the evidence" onRetry={() => void run.refetch()} />}
      {open && run.isSuccess && evidence.length === 0 && <p className="m-0 mt-1 text-xs text-mid">This run holds none of this evidence any more.</p>}
      {open && evidence.length > 0 && (
        <div className="mt-1 flex max-w-[560px] gap-2">
          {evidence.map((ev) => (
            <EvidenceCard key={ev.id} evidence={ev} className="max-w-[180px]" />
          ))}
        </div>
      )}
    </div>
  )
}

export function Timeline({ entries, nowLabel }: { entries: TimelineEntry[]; nowLabel?: string | undefined }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-3 text-xs text-mid">
        <BatonLegend />
        <span className="inline-flex items-center gap-1.5">
          <PartyMark who="nobody" />
          System
        </span>
      </div>
      <ol className="relative m-0 list-none py-0 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-0.5 before:bg-line">
        {entries.map((e) => (
          <li key={e.id} data-lane={e.lane} className="relative pb-3">
            <PartyMark who={e.who ?? LANE_PARTY[e.lane]} className="absolute -left-6 top-[5px]" />
            <div className="text-xs text-soft">
              {dateTime(e.at)}
              {e.lane === 'agent' ? ' · ✦ agent' : ''}
              {e.lane === 'human' && e.actor ? ` · ${e.actor}` : ''}
              {e.lane === 'payer' ? ' · payer' : ''}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
              <span>{e.title}</span>
              {e.root_cause === 'ours' && <span className="rounded-full border border-risk-line bg-risk-bg px-2 text-xs font-semibold leading-[18px] text-risk-ink">root cause: ours</span>}
            </div>
            {e.detail && <div className="text-sm leading-[1.4] text-mid">{e.detail}</div>}
            {e.evidence_ids && e.evidence_ids.length > 0 && (e.run_id ? <RunEvidence runId={e.run_id} ids={e.evidence_ids} /> : <div className="mt-1 text-xs text-mid">{EVIDENCE_LABEL(e.evidence_ids.length)}</div>)}
          </li>
        ))}
        {nowLabel && (
          <li className="relative pb-1">
            <span className="absolute -left-[22px] top-[3px] h-3 w-3 rounded-full border-2 border-act bg-paper shadow-[0_0_0_3px_var(--color-act-bg)]" aria-hidden />
            <div className="text-xs text-soft">Now</div>
            <div className="text-sm font-medium">{nowLabel}</div>
          </li>
        )}
      </ol>
    </div>
  )
}
