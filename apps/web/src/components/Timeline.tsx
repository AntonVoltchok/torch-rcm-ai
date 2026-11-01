/** The claim's story, newest last, in three lanes: agent ✦, payer/system ●, you ●. Agent errors are owned. */
import type { TimelineEntry } from '@/api/schema'
import { dateTime } from '@/lib/format'
import { AGENT_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { EvidenceCard } from './EvidenceCard'
import { TierBadge } from './TierBadge'

const DOT: Record<TimelineEntry['lane'], string> = {
  agent: 'border-acc bg-acc',
  payer: 'border-soft bg-white',
  system: 'border-soft bg-white',
  human: 'border-ink bg-ink',
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
              {e.lane === 'agent' && e.agent ? ` · ✦ ${AGENT_NAME[e.agent]}` : ''}
              {e.lane === 'human' && e.actor ? ` · ${e.actor}` : ''}
              {e.lane === 'payer' ? ' · payer' : ''}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-semibold">
              <span>{e.title}</span>
              {e.tier ? <TierBadge tier={e.tier} compact /> : null}
              {e.root_cause === 'ours' && <span className="rounded border border-bad-line bg-bad-bg px-1 text-2xs font-bold text-bad">root cause: ours</span>}
            </div>
            {e.detail && <div className="text-sm text-mid">{e.detail}</div>}
            {e.evidence.length > 0 && (
              <div className="mt-1 flex max-w-[560px] gap-2">
                {e.evidence.map((ev) => (
                  <EvidenceCard key={ev.id} evidence={ev} className="max-w-[180px]" />
                ))}
              </div>
            )}
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
