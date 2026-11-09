/**
 * TanStack Table (headless) + TanStack Virtual: fixed 36px rows, ~30 in the DOM, sticky header.
 * Sorting is server-side: the header calls `onSort(sortKey)` and the caller writes it to the URL.
 * Pages load as the user nears the end (useInfiniteQuery in the caller).
 */
import { useEffect, useRef } from 'react'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowData } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/cn'

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    width?: string
    sortKey?: string
    align?: 'left' | 'right'
  }
}

export const ROW_HEIGHT = 36

interface Props<T> {
  columns: ColumnDef<T>[]
  data: T[]
  getRowId: (row: T) => string
  sort: { key: string; desc: boolean }
  onSort: (key: string) => void
  selectedId?: string | undefined
  onRowClick: (row: T) => void
  rowClassName?: (row: T) => string | false | undefined
  hasNextPage?: boolean
  onNearEnd?: () => void
  dimmed?: boolean
  label: string
  /** The onboarding tour's anchor name, if a tour step points at this table. */
  tour?: string
}

export function DataTable<T>({ columns, data, getRowId, sort, onSort, selectedId, onRowClick, rowClassName, hasNextPage, onNearEnd, dimmed, label, tour }: Props<T>) {
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => getRowId(r), manualSorting: true })
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 10 })
  const items = virtualizer.getVirtualItems()
  const grid = table.getVisibleLeafColumns().map((c) => c.columnDef.meta?.width ?? '1fr').join(' ')

  const lastIndex = items[items.length - 1]?.index ?? 0
  useEffect(() => {
    if (hasNextPage && lastIndex >= rows.length - 20) onNearEnd?.()
  }, [hasNextPage, lastIndex, rows.length, onNearEnd])

  const selectedIndex = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1
  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [selectedIndex, virtualizer])

  return (
    <div ref={scrollRef} role="table" aria-label={label} data-tour={tour} aria-rowcount={rows.length} className={cn('relative min-h-0 flex-1 overflow-auto', dimmed && 'opacity-60 transition-opacity')}>
      <div role="rowgroup" className="sticky top-0 z-10 border-b border-line bg-paper">
        {table.getHeaderGroups().map((hg) => (
          <div role="row" key={hg.id} className="grid h-8 items-center" style={{ gridTemplateColumns: grid }}>
            {hg.headers.map((h) => {
              const key = h.column.columnDef.meta?.sortKey
              const active = key !== undefined && key === sort.key
              const align = h.column.columnDef.meta?.align === 'right' ? 'justify-end text-right' : ''
              return (
                <div
                  role="columnheader"
                  key={h.id}
                  aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
                  className={cn('flex px-2 text-xs font-medium text-soft', align)}
                >
                  {key ? (
                    <button type="button" className={cn('inline-flex items-center gap-1 hover:text-ink', active && 'text-ink')} onClick={() => onSort(key)}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <span aria-hidden>{active ? (sort.desc ? '↓' : '↑') : ''}</span>
                    </button>
                  ) : (
                    flexRender(h.column.columnDef.header, h.getContext())
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((vi) => {
          const row = rows[vi.index]
          if (!row) return null
          const selected = row.id === selectedId
          return (
            <div
              role="row"
              key={row.id}
              data-row-id={row.id}
              aria-selected={selected}
              onClick={() => onRowClick(row.original)}
              className={cn(
                'absolute left-0 right-0 grid cursor-pointer items-center border-b border-line text-base hover:bg-hover',
                selected && 'bg-act-bg shadow-[inset_0_0_0_1px_var(--color-act-line)] hover:bg-act-bg',
                rowClassName?.(row.original),
              )}
              style={{ height: ROW_HEIGHT, transform: `translateY(${vi.start}px)`, gridTemplateColumns: grid }}
            >
              {row.getVisibleCells().map((cell) => (
                <div role="cell" key={cell.id} className={cn('min-w-0 truncate px-2', cell.column.columnDef.meta?.align === 'right' && 'text-right')}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
