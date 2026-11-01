import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface Col<T> {
  header: string
  cell: (r: T) => ReactNode
  className?: string
}

/** Plain table for the static screens (small row counts; no virtualisation needed). Sticky header, 36px rows. */
export function SimpleTable<T>({
  rows,
  cols,
  rowKey,
  rowClassName,
  rowProps,
  label,
}: {
  rows: T[]
  cols: Col<T>[]
  rowKey: (r: T) => string
  rowClassName?: (r: T) => string | false | undefined
  rowProps?: (r: T) => Record<string, string | undefined>
  label: string
}) {
  return (
    <table aria-label={label} className="w-full border-collapse text-base">
      <thead className="sticky top-0 bg-fill">
        <tr>
          {cols.map((c) => (
            <th key={c.header} className={cn('h-8 border-b border-line px-2 text-left text-2xs font-extrabold uppercase tracking-[.05em] text-soft', c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)} className={cn('h-9 border-b border-light', rowClassName?.(r))} {...rowProps?.(r)}>
            {cols.map((c) => (
              <td key={c.header} className={cn('px-2', c.className)}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function StaticNote({ children }: { children: ReactNode }) {
  return <div className="flex-none border-b border-line bg-fill px-[18px] py-1.5 text-xs text-mid">{children}</div>
}
