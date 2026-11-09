/**
 * Claims: the map. URL holds every filter, the sort and the selected row (`?status=denied&sort=-age&row=clm_4733`);
 * the query cache holds pages of rows; header numbers come from the strip. Server sorts and filters.
 */
import { useCallback } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import type { ClaimRow } from '@/api/schema'
import { useClaimsList } from '@/hooks/useClaims'
import { useListKeys } from '@/hooks/useListKeys'
import { useStrip } from '@/hooks/useStrip'
import { count, money } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { QueryError } from '@/components/QueryError'
import { Kbd } from '@/components/ui/Kbd'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ClaimsFilters } from './ClaimsFilters'
import { claimColumns } from './columns'
import { SavedViews } from './SavedViews'
import { DEFAULT_SORT, parseSort, toggleSort, type SortField } from './search'

const route = getRouteApi('/claims/')

export function ClaimsPage() {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/claims/' })
  const strip = useStrip()
  const list = useClaimsList(search)
  const rows: ClaimRow[] = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total
  const sort = parseSort(search.sort ?? DEFAULT_SORT)

  const open = (row: ClaimRow) => void navigate({ to: '/claims/$claimId', params: { claimId: row.id }, search: { from: 'claims:' } })
  const selectRow = (id: string) => void navigate({ search: (s) => ({ ...s, row: id }), replace: true })
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  const onNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  useListKeys({
    ids: rows.map((r) => r.id),
    selectedId: search.row,
    onSelect: selectRow,
    onOpen: (id) => {
      const r = rows.find((x) => x.id === id)
      if (r) open(r)
    },
  })

  const s = strip.data
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Claims"
        sub={s ? `${count(s.open_count)} open · ${money(s.ar_cents)} in A/R · ${count(s.paid_month_count)} paid in ${s.paid_month_label}` : undefined}
      />
      <SavedViews search={search} strip={s} />
      <ClaimsFilters />
      {list.isPending ? (
        <SkeletonRows rows={14} />
      ) : list.isError ? (
        <QueryError error={list.error} what="claims" onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No claims match" action={<button type="button" className="font-semibold text-act underline" onClick={() => void navigate({ search: {} })}>Clear filters</button>}>
          The filters are kept in the URL, so this link reproduces the empty result.
        </EmptyState>
      ) : (
        <DataTable
          label="Claims"
          tour="claims-table"
          columns={claimColumns}
          data={rows}
          getRowId={(r) => r.id}
          sort={{ key: sort.field, desc: sort.desc }}
          onSort={(key) => void navigate({ search: (p) => ({ ...p, sort: toggleSort(p.sort ?? DEFAULT_SORT, key as SortField) }), replace: true })}
          selectedId={search.row}
          onRowClick={open}
          rowClassName={(r) => r.needs_action && search.flag !== true && 'font-medium'}
          hasNextPage={hasNextPage}
          onNearEnd={onNearEnd}
          dimmed={list.isPlaceholderData}
        />
      )}
      <div className="flex flex-none items-center gap-3 border-t border-line bg-fill px-3.5 py-1.5 text-xs text-mid">
        <span>{total !== undefined ? `${count(total)} claims match` : '…'}</span>
        <span>Age = days since sent ·</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-age-ok" />0–30</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-age-warn" />31–60</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-age-bad" />61–90</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm bg-age-dark" />90+</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> rows · <Kbd>Enter</Kbd> open
        </span>
      </div>
    </div>
  )
}
