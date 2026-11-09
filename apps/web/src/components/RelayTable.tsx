/**
 * D1's relay table: one row per claim the decision or run touches, with status and whose move as two separate
 * columns (a denied claim can be with the agents). The decision pane and the run pane draw it in the same place,
 * so after Approve the rows stay put and only their batons move.
 */
import type { ReactNode } from 'react'
import type { ClaimStatus } from '@/api/schema'
import { money } from '@/lib/format'
import { cn } from '@/lib/cn'
import { BatonLegend } from './Baton'
import { StatusChip } from './StatusChip'

export const RELAY_COLS = 'grid grid-cols-[minmax(0,1fr)_64px_96px_170px] items-center gap-3 px-3'

export function RelayTable({ count, payer, children }: { count: number; payer?: string | undefined; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-line" data-tour="relay">
      <div className={cn(RELAY_COLS, 'h-8 rounded-t-lg border-b border-line bg-fill text-xs font-medium text-soft')}>
        <span>{count > 1 ? `${count} claims` : 'Claim'}</span>
        <span className="text-right">Billed</span>
        <span>Status</span>
        <span>
          <BatonLegend payer={payer} />
        </span>
      </div>
      {children}
    </div>
  )
}

export function RelayRow(p: {
  name: ReactNode
  cents: number | null | undefined
  status: ClaimStatus | null | undefined
  baton: ReactNode
  selected?: boolean
  className?: string
}) {
  return (
    <div className={cn(RELAY_COLS, 'min-h-[42px] border-b border-line py-1.5 last:border-b-0', p.selected && 'bg-act-bg', p.className)}>
      <span className="min-w-0 truncate">{p.name}</span>
      <span className="text-right tabular-nums">{p.cents != null ? money(p.cents) : ''}</span>
      <span>{p.status ? <StatusChip status={p.status} /> : <span className="text-sm text-mid">Upcoming visit</span>}</span>
      <span className="flex h-[22px] items-center">{p.baton}</span>
    </div>
  )
}
