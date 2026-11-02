/** The claim's story, newest last, in three lanes: agent ✦, payer/system ●, you ●. Agent errors are owned. */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Evidence, RunViewEvidence, TimelineEntry } from '@/api/schema'
import { runQueryOptions } from '@/hooks/useRun'
import { dateTime, plural } from '@/lib/format'
import { cn } from '@/lib/cn'
import { SkeletonBlock } from './ui/Skeleton'
import { EvidenceCard } from './EvidenceCard'
import { QueryError } from './QueryError'

const DOT: Record<TimelineEntry['lane'], string> = {
  agent: 'border-acc bg-acc',
  payer: 'border-soft bg-white',
  system: 'border-soft bg-white',
  human: 'border-ink bg-ink',
}

const isHydrated = (e: RunViewEvidence): e is Evidence => e.excerpt !== undefined
const EVIDENCE_LABEL = (n: number) => plural(n, 'evidence item')

/** The timeline carries evidence ids; the run holds the objects, fetched when someone asks (no N+1 on the claim). */
function RunEvidence({ runId, ids }: { runId: string; ids: string[] }) {
  const [open, setOpen] = useState(false)
  const run = useQuery({ ...runQueryOptions(runId), enabled: open })
  const evidence = (run.data?.evidence ?? []).filter(isHydrated).filter((e) => ids.includes(e.id))
  return (
    <div className="mt-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-xs font-semibold text-acc hover:underline">
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
      <div className="mb-2 flex items-center gap-3 text-xs text-mid">
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-acc" /> agents
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full border-2 border-soft" /> payer / system
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="inline-block h-2 w-2 rounded-full bg-ink" /> you
        </span>
      </div>
      <ol className="relative m-0 list-none py-0 pl-5 before:absolute before:bottom-1.5 before:left-[6px] before:top-1.5 before:border-l-2 before:border-line">
        {entries.map((e) => (
          <li key={e.id} data-lane={e.lane} className="relative pb-2.5">
            <span className={cn('absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full border-2', DOT[e.lane])} aria-hidden />
            <div className="text-2xs text-soft">
              {dateTime(e.at)}
              {e.lane === 'agent' ? ' · ✦ agent' : ''}
              {e.lane === 'human' && e.actor ? ` · ${e.actor}` : ''}
              {e.lane === 'payer' ? ' · payer' : ''}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-semibold">
              <span>{e.title}</span>
              {e.root_cause === 'ours' && <span className="rounded border border-bad-line bg-bad-bg px-1 text-2xs font-bold text-bad">root cause: ours</span>}
            </div>
            {e.detail && <div className="text-sm text-mid">{e.detail}</div>}
            {e.evidence_ids && e.evidence_ids.length > 0 && (e.run_id ? <RunEvidence runId={e.run_id} ids={e.evidence_ids} /> : <div className="mt-1 text-xs text-mid">{EVIDENCE_LABEL(e.evidence_ids.length)}</div>)}
          </li>
        ))}
        {nowLabel && (
          <li className="relative pb-1">
            <span className="absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full border-2 border-acc bg-white shadow-[0_0_0_3px_var(--color-acc-line)]" aria-hidden />
            <div className="text-2xs text-soft">Now</div>
            <div className="font-semibold">{nowLabel}</div>
          </li>
        )}
      </ol>
    </div>
  )
}
