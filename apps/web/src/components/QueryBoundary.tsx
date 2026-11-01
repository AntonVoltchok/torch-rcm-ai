import type { ReactNode } from 'react'
import { QueryError } from './QueryError'
import { SkeletonRows } from './ui/Skeleton'

interface QueryLike<T> {
  isPending: boolean
  isError: boolean
  error: unknown
  data: T | undefined
  refetch: () => unknown
}

/** Skeleton rows while pending, inline error with retry, then the content — the same three states on every screen. */
export function Load<T>({ q, what, rows = 10, skeleton, children }: { q: QueryLike<T>; what: string; rows?: number; skeleton?: ReactNode; children: (d: T) => ReactNode }) {
  if (q.isPending) return <>{skeleton ?? <SkeletonRows rows={rows} />}</>
  if (q.isError || q.data === undefined) return <QueryError error={q.error} what={what} onRetry={() => void q.refetch()} />
  return <>{children(q.data)}</>
}

export const Scroll = ({ children, className }: { children: ReactNode; className?: string }) => <div className={`min-h-0 flex-1 overflow-auto ${className ?? ''}`}>{children}</div>
