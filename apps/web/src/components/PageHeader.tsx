import type { ReactNode } from 'react'
import { TopBarControls } from '@/features/shell/TopBarControls'

/** Screen title on the left; screen actions, then the global search / location / clock on the right. */
export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-[52px] flex-none items-center gap-3 border-b border-line px-[18px]">
      <h1 className="m-0 whitespace-nowrap text-[19px] font-bold">{title}</h1>
      {sub && <span className="truncate text-sm text-mid">{sub}</span>}
      <div className="ml-auto flex items-center gap-2.5">
        {children}
        <TopBarControls />
      </div>
    </header>
  )
}
