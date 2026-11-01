import { Link } from '@tanstack/react-router'
import type { ClaimStatus } from '@/api/schema'
import { useStrip } from '@/hooks/useStrip'
import { arTotals, flaggedTotal, openTotals, stripTiles } from '@/lib/strip'
import { count, money } from '@/lib/format'
import { SkeletonBlock } from './ui/Skeleton'
import { StageTile } from './StageTile'

/**
 * The nine-status pipeline. Every number is the server's (GET /summary/strip, patched from `meta.counts`);
 * if the strip fails the tiles show "—", never 0.
 */
export function PipelineStrip({ active }: { active?: readonly ClaimStatus[] | undefined }) {
  const strip = useStrip()
  if (strip.isPending) {
    return (
      <div className="flex gap-2 border-b border-line bg-fill px-4 py-2">
        {Array.from({ length: 9 }, (_, i) => (
          <SkeletonBlock key={i} className="h-[58px] flex-1" />
        ))}
      </div>
    )
  }
  if (strip.isError) {
    return (
      <div className="flex items-center gap-3 border-b border-line bg-fill px-4 py-2 text-sm text-mid">
        Claim pipeline — counts unavailable.
        <button type="button" className="font-semibold text-acc underline" onClick={() => void strip.refetch()}>
          Retry
        </button>
      </div>
    )
  }
  const s = strip.data
  const open = openTotals(s)
  const ar = arTotals(s)
  return (
    <section aria-label="Claim pipeline" className="border-b border-line bg-fill px-4 pb-2 pt-1.5">
      <div className="mb-1 flex items-center gap-2 text-xs text-mid">
        <span>
          Claim pipeline · <b className="text-ink">{count(open.count)} open</b> · <b className="text-ink">{money(ar.cents)}</b> in A/R · click a stage to open Claims, pre-filtered
        </span>
        <Link to="/claims" search={{ flag: true }} className="ml-auto font-bold text-bad no-underline hover:underline">
          ⚑ {count(flaggedTotal(s))} claims need action →
        </Link>
      </div>
      <div className="flex gap-1.5">
        {stripTiles(s).map((t) => (
          <StageTile key={t.status} tile={t} active={active?.length === 1 && active[0] === t.status} />
        ))}
      </div>
    </section>
  )
}
