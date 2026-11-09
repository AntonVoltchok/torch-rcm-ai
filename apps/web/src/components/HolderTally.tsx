import type { HolderCount, MoveWho } from '@/api/schema'
import { cn } from '@/lib/cn'
import { USERS } from '@/state/session'
import { partyWord } from './Baton'

const ORDER: readonly MoveWho[] = ['practice', 'agents', 'payer', 'nobody']

/**
 * One tick per claim in a status, in its holder's shape and hue: the Denied segment of the pipeline. The rows
 * are the server's `StripTile.by_holder`; `mine` is the server's too. Approving three denials recolours three
 * ticks while the segment, and its count, stay the same.
 */
export function HolderTally({ rows, fill = false, className }: { rows: readonly HolderCount[]; fill?: boolean; className?: string }) {
  const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.who) - ORDER.indexOf(b.who))
  const text = holderSentence(sorted)
  return (
    <span role="img" aria-label={text} title={text} className={cn(fill ? 'flex h-full flex-1 gap-px' : 'inline-flex gap-0.5 align-middle', className)}>
      {sorted.flatMap((r, i) =>
        Array.from({ length: r.count }, (_, j) => (
          <i
            key={`${i}-${j}`}
            className={cn('party-tick', `party-shape-${r.who}`, fill && 'h-full! w-auto! flex-1', r.who === 'practice' && !r.mine && 'opacity-60')}
          />
        )),
      )}
    </span>
  )
}

/** "3 with you, 2 with the agents". A practice holder who is not the viewer is named ("1 with Dr. Morgan"). */
export function holderSentence(rows: readonly HolderCount[]): string {
  const parts = rows.filter((r) => r.count > 0).map((r) => `${r.count} ${r.who === 'nobody' ? 'held by nobody' : `with ${holderName(r)}`}`)
  return parts.join(', ') || 'none'
}

function holderName(r: HolderCount): string {
  if (r.who !== 'practice' || r.mine) return partyWord(r.who, r.mine)
  return USERS.find((u) => u.id === r.holder_user_id)?.name ?? partyWord('practice')
}
