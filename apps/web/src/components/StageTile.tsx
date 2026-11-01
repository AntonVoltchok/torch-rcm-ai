import { Link } from '@tanstack/react-router'
import type { TileView } from '@/lib/strip'
import { moneyCompact, count } from '@/lib/format'
import { cn } from '@/lib/cn'
import { FlagPill } from './FlagPill'

/** One pipeline stage. A link, not a button: it opens Claims pre-filtered (`/claims?status=denied`). */
export function StageTile({ tile, active = false }: { tile: TileView; active?: boolean }) {
  return (
    <Link
      to="/claims"
      search={{ status: [tile.status] }}
      aria-label={`${tile.label} ${tile.count}`}
      className={cn(
        'flex min-w-0 flex-1 flex-col rounded-md border bg-white px-2.5 py-1.5 text-left no-underline transition-colors hover:border-acc',
        active ? 'border-acc shadow-[0_0_0_1px_var(--color-acc)]' : 'border-line',
      )}
    >
      <span className="flex items-center gap-1 text-xs text-mid">
        <span className="truncate">{tile.label}</span>
        {tile.flagged > 0 && <FlagPill count={tile.flagged} className="ml-auto" />}
      </span>
      <span className="text-[17px] font-extrabold leading-tight text-ink">{count(tile.count)}</span>
      <span className="text-xs text-mid">{moneyCompact(tile.cents)}</span>
    </Link>
  )
}
