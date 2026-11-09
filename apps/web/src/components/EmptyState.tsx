import type { ReactNode } from 'react'

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
      <div className="text-md font-semibold text-ink">{title}</div>
      {children && <div className="max-w-[420px] text-sm leading-[1.5] text-mid">{children}</div>}
      {action && <div className="mt-2 text-sm">{action}</div>}
    </div>
  )
}
