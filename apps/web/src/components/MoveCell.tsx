import type { ClaimMove } from '@/api/schema'
import { cn } from '@/lib/cn'
import { Baton, batonProps, PARTY_TEXT } from './Baton'

/**
 * Whose move on a listed claim: the small baton and the server's `move.label`, in the holder's hue. One line that
 * truncates (fixed-height virtual rows), or with `wrap` a label that breaks onto more lines so a plain table fits its width.
 */
export function MoveCell({ move, className, wrap }: { move: ClaimMove; className?: string; wrap?: boolean }) {
  return (
    <span className={cn('flex w-full min-w-0 gap-2', wrap ? 'items-baseline' : 'items-center', className)}>
      <Baton {...batonProps(move)} decorative />
      <span className={cn('min-w-0', wrap ? 'leading-snug' : 'truncate', PARTY_TEXT[move.who])}>{move.label}</span>
    </span>
  )
}
