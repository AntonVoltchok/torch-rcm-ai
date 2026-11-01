import { cn } from '@/lib/cn'

/** Skeleton rows at the same 36px height as real rows, so nothing jumps when data lands. */
export function SkeletonRows({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div aria-busy="true" aria-label="Loading" className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 border-b border-light px-3">
          <div className="animate-torch-pulse h-2.5 rounded bg-light" style={{ width: `${30 + ((i * 37) % 50)}%` }} />
          <div className="animate-torch-pulse ml-auto h-2.5 w-14 rounded bg-light" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-torch-pulse rounded bg-light', className)} />
}
