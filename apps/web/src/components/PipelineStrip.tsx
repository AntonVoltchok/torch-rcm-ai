import { Link } from '@tanstack/react-router'
import type { ClaimStatus } from '@/api/schema'
import { useStrip } from '@/hooks/useStrip'
import { stripTiles, type TileView } from '@/lib/strip'
import { count, money } from '@/lib/format'
import { cn } from '@/lib/cn'
import { SkeletonBlock } from './ui/Skeleton'
import { StageTile } from './StageTile'
import { HolderTally } from './HolderTally'

/**
 * The nine-status pipeline. Every number is the server's (GET /summary/strip, patched from `meta.counts`); if the
 * strip fails the cells say so, never 0. Two forms:
 *  - `card`: the Inbox header card. A to-scale bar of the open claims, drawn neutral because status is not whose
 *    move; only Denied has colour, one tick per claim in its holder's hue (`by_holder`). Then every stage as a link.
 *  - `line`: one row of the same links for every other screen.
 */
export function PipelineStrip({ variant = 'line', active }: { variant?: 'card' | 'line'; active?: readonly ClaimStatus[] | undefined }) {
  const strip = useStrip()
  const card = variant === 'card'
  if (strip.isPending) {
    return card ? <SkeletonBlock className="h-full min-h-[108px] rounded-panel" /> : <SkeletonBlock className="mx-4 my-3 h-5" />
  }
  if (strip.isError) {
    return (
      <section aria-label="Claim pipeline" className={cn('flex items-center gap-3 text-sm text-mid', card ? 'panel px-4 py-3' : 'px-5 py-3')}>
        Claim pipeline: counts unavailable.
        <button type="button" className="font-semibold text-act underline" onClick={() => void strip.refetch()}>
          Retry
        </button>
      </section>
    )
  }
  const s = strip.data
  const tiles = stripTiles(s)
  const open = tiles.filter((t) => t.status !== 'paid')
  const paid = tiles.find((t) => t.status === 'paid')
  const isActive = (t: TileView) => active?.length === 1 && active[0] === t.status
  const totals = (
    <span>
      <strong className="font-semibold text-ink">{count(s.open_count)} open</strong>, {money(s.ar_cents)} A/R
    </span>
  )
  const flagged = (
    <Link
      to="/claims"
      search={{ flag: true }}
      title="Claims with the needs-action flag, across every status"
      className="-mx-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-sm text-mid no-underline hover:bg-hover hover:text-ink"
    >
      <span aria-hidden>⚑</span>
      <span>Need action</span> <strong className="font-semibold text-ink">{count(s.flagged_count)}</strong>
    </Link>
  )

  if (!card) {
    return (
      <section aria-label="Claim pipeline" className="flex flex-none items-center gap-x-4 overflow-hidden px-5 pb-2.5 pt-3">
        {open.map((t) => (
          <span key={t.status} className="inline-flex items-center gap-1.5">
            <StageTile tile={t} active={isActive(t)} />
            {t.status === 'denied' && t.by_holder.length > 0 && <HolderTally rows={t.by_holder} />}
          </span>
        ))}
        {paid && <StageTile tile={paid} active={isActive(paid)} />}
        <span className="ml-auto flex items-center gap-4 whitespace-nowrap text-sm text-soft">
          {flagged}
          {totals}
        </span>
      </section>
    )
  }

  return (
    <section aria-label="Claim pipeline" className="panel flex min-w-0 flex-col px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-sm text-mid">
        {totals}
        {paid && <StageTile tile={paid} active={isActive(paid)} showMoney />}
      </div>
      <div role="img" aria-label={`Open claims by status, to scale: ${open.map((t) => `${t.label} ${t.count}`).join(', ')}`} className="mt-2 flex h-2.5 gap-0.5">
        {open
          .filter((t) => t.count > 0)
          .map((t, i) =>
            t.status === 'denied' ? (
              <span key={t.status} className="flex min-w-0.5" style={{ flex: `${t.count} 0 0` }}>
                <HolderTally rows={t.by_holder.length > 0 ? t.by_holder : [{ who: 'nobody', holder_role: null, holder_user_id: null, mine: false, count: t.count }]} fill />
              </span>
            ) : (
              <span key={t.status} className={cn('min-w-0.5 rounded-[2px]', i % 2 ? 'bg-[#dde1e8]' : 'bg-[#cbd1db]')} style={{ flex: `${t.count} 0 0` }} />
            ),
          )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-px">
        {open.map((t) => (
          <StageTile key={t.status} tile={t} active={isActive(t)} />
        ))}
        {flagged}
      </div>
    </section>
  )
}
