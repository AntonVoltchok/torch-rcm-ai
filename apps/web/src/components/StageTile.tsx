import { Link } from '@tanstack/react-router'
import type { TileView } from '@/lib/strip'
import { count, money } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * One pipeline stage: "Denied 5". A link, not a button: it opens Claims pre-filtered (`/claims?status=denied`).
 * The visible label and count are the accessible name; the money is in the title. Denied is the one cell in the risk hue.
 */
export function StageTile({ tile, active = false, showMoney = false }: { tile: TileView; active?: boolean; showMoney?: boolean }) {
  const denied = tile.status === 'denied'
  return (
    <Link
      to="/claims"
      search={{ status: [tile.status] }}
      title={`${tile.label}: ${count(tile.count)} claims, ${money(tile.cents)} ${tile.cents_basis === 'paid' ? 'paid' : 'billed'}`}
      aria-current={active ? 'true' : undefined}
      // With the money shown, the name stays "Paid · Oct 118" (the money is a detail, as in the title).
      aria-label={showMoney ? `${tile.label} ${count(tile.count)}` : undefined}
      data-status={tile.status}
      className={cn(
        '-mx-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-sm text-mid no-underline hover:bg-hover hover:text-ink',
        denied && 'font-medium text-risk-ink hover:text-risk-ink',
        active && 'bg-act-bg text-ink shadow-[inset_0_0_0_1px_var(--color-act-line)]',
      )}
    >
      <span>{tile.label}</span> <strong className={cn('font-semibold', denied ? 'text-risk-ink' : 'text-ink')}>{count(tile.count)}</strong>
      {showMoney && <span className="text-soft">· {money(tile.cents)}</span>}
    </Link>
  )
}
