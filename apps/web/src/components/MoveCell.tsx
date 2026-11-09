import type { ClaimMove } from '@/api/schema'
import { cn } from '@/lib/cn'
import { Baton, batonProps, PARTY_TEXT } from './Baton'

/** Whose move on a listed claim: the small baton and the server's `move.label`, in the holder's hue. One line, truncates. */
export function MoveCell({ move, className }: { move: ClaimMove; className?: string }) {
  return (
    <span className={cn('flex w-full min-w-0 items-center gap-2', className)}>
      <Baton {...batonProps(move)} decorative />
      <span className={cn('min-w-0 truncate', PARTY_TEXT[move.who])}>{move.label}</span>
    </span>
  )
}
