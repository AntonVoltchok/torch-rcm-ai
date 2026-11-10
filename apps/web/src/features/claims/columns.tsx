/** Claims table columns. Display columns reading `row.original`: sorting is server-side, so no accessors are needed. */
import { createColumnHelper } from '@tanstack/react-table'
import type { ClaimRow } from '@/api/schema'
import { ageTone, dateTime, money, shortDate } from '@/lib/format'
import { PAYER_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { AgentChip } from '@/components/AgentChip'
import { MoveCell } from '@/components/MoveCell'
import { FlagPill } from '@/components/FlagPill'
import { StatusChip } from '@/components/StatusChip'

const col = createColumnHelper<ClaimRow>()
const AGE_CLASS = { ok: 'bg-age-ok', warn: 'bg-age-warn', bad: 'bg-age-bad', dark: 'bg-age-dark' } as const
const muted = (v: string | null | undefined) => <span className="text-mid">{v ?? '—'}</span>

/**
 * Widths: the minimums sum to 1018px, so the table fits the 1038px main area at the 1280px app minimum with room for a
 * classic scrollbar. Each minimum fits its header plus the sort arrow; Whose move keeps "Waiting on MetLife" whole and
 * takes the largest share (2fr) of wider windows. Cells stay one line and truncate (fixed 36px virtual rows).
 */
export const claimColumns = [
  col.display({ id: 'number', header: 'Claim #', meta: { width: '68px', sortKey: 'number' }, cell: ({ row }) => <b>#{row.original.number}</b> }),
  col.display({ id: 'patient', header: 'Patient', meta: { width: 'minmax(70px,1fr)', sortKey: 'patient' }, cell: ({ row }) => row.original.patient.display_name }),
  col.display({ id: 'payer', header: 'Payer', meta: { width: '94px', sortKey: 'payer' }, cell: ({ row }) => PAYER_NAME[row.original.payer.key] }),
  col.display({ id: 'dos', header: 'DOS', meta: { width: '56px', sortKey: 'dos' }, cell: ({ row }) => shortDate(row.original.dos) }),
  col.display({ id: 'procedures', header: 'Procedures', meta: { width: 'minmax(76px,1fr)' }, cell: ({ row }) => muted(row.original.procedures) }),
  col.display({ id: 'billed', header: 'Billed', meta: { width: '68px', sortKey: 'billed', align: 'right' }, cell: ({ row }) => <b>{money(row.original.billed_cents)}</b> }),
  col.display({
    id: 'status',
    header: 'Status',
    meta: { width: '92px', sortKey: 'status' },
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1">
        <StatusChip status={row.original.status} />
        {row.original.needs_action && <FlagPill />}
      </span>
    ),
  }),
  col.display({ id: 'reason', header: 'Reason', meta: { width: 'minmax(60px,1fr)' }, cell: ({ row }) => muted(row.original.reason) }),
  col.display({
    id: 'age',
    header: 'Age',
    meta: { width: '52px', sortKey: 'age', align: 'right' },
    cell: ({ row }) => {
      const d = row.original.age_days
      const tone = ageTone(d)
      if (d === null || d === undefined) return <span className="text-soft">—</span>
      return (
        <span className="inline-flex items-center gap-1" title="Days since sent">
          {tone && <i className={cn('inline-block h-2 w-2 rounded-sm', AGE_CLASS[tone])} aria-hidden />}
          {d}
        </span>
      )
    },
  }),
  col.display({
    id: 'move',
    header: 'Whose move',
    meta: { width: 'minmax(206px,2fr)' },
    cell: ({ row }) => <MoveCell move={row.original.move} />,
  }),
  col.display({
    id: 'agent',
    header: 'Agent note',
    meta: { width: 'minmax(80px,1fr)' },
    cell: ({ row }) => {
      const note = row.original.agent_note
      return note ? <AgentChip label={note} /> : <span className="text-soft">—</span>
    },
  }),
  col.display({
    id: 'last_activity',
    header: 'Last activity',
    meta: { width: 'minmax(96px,1fr)', sortKey: 'last_activity' },
    cell: ({ row }) => {
      const { last_activity_at: at, last_activity: label } = row.original
      return at ? muted(`${dateTime(at)} · ${label ?? ''}`) : <span className="text-soft">—</span>
    },
  }),
]
