import { cn } from '@/lib/cn'

/** ⚑ needs action: a flag on top of status (an open Inbox item references the claim). Amber: it is the practice's move. */
export function FlagPill({ count, label, className }: { count?: number | undefined; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-semibold text-practice-ink', className)} title="Needs action: an open Inbox item references this claim">
      ⚑{count !== undefined ? ` ${count}` : ''}
      {label ? <span className="font-semibold"> {label}</span> : null}
    </span>
  )
}
