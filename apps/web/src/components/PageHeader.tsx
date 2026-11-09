import type { ReactNode } from 'react'
import { TopBarControls } from '@/features/shell/TopBarControls'
import { TourHeaderButton } from '@/features/tour/TourEntry'

/** Screen title on the left; screen actions, then search and location on the right. The top row of the screen's panel. */
export function PageHeader({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-14 flex-none items-center gap-3 border-b border-line px-5 py-2.5" data-tour="page-header">
      <h1 className="m-0 whitespace-nowrap text-title font-semibold">{title}</h1>
      {sub && <span className="truncate text-sm text-mid">{sub}</span>}
      <div className="ml-auto flex items-center gap-2.5">
        {children}
        <TopBarControls />
        <TourHeaderButton />
      </div>
    </header>
  )
}
