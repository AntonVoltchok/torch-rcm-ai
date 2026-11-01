import type { ReactNode } from 'react'

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
      <div className="text-[15px] font-bold">{title}</div>
      {children && <div className="max-w-[420px] text-sm text-mid">{children}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  )
}
