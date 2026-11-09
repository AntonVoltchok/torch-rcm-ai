/**
 * Quick views (fixed filters, counts are strip fields as sent) and saved views (server, GET/POST /views).
 * The list is month-to-date for paid claims, as the strip: "Open + Paid · Oct" is the unfiltered list
 * (`all_count`), "Paid · Oct" the Paid tile (`paid_month_count`, = `GET /claims?status=paid`). A search reaches
 * older paid claims. Applying a view navigates: the URL stays the only filter state, `view` just remembers which one.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { StripSummary } from '@/api/schema'
import { useSaveView, useViews } from '@/hooks/useClaims'
import { tileFor } from '@/lib/strip'
import { count } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { claimsSearchSchema, filtersOf, type ClaimsSearch } from './search'

type Quick = {
  id: string
  label: (s: StripSummary | undefined) => string
  title?: (s: StripSummary | undefined) => string
  search: ClaimsSearch
  n?: (s: StripSummary) => number | undefined
}
const month = (s: StripSummary | undefined) => s?.paid_month_label ?? 'this month'
const QUICK: Quick[] = [
  {
    id: 'all',
    label: (s) => `Open + Paid · ${month(s)}`,
    title: (s) => `Open claims plus claims paid in ${month(s)}. Search finds older paid claims.`,
    search: {},
    n: (s) => s.all_count,
  },
  { id: 'flag', label: () => '⚑ Needs action', search: { flag: true }, n: (s) => s.flagged_count },
  { id: 'rejected', label: () => 'Rejected', search: { status: ['rejected'] }, n: (s) => tileFor(s, 'rejected')?.count },
  { id: 'denied', label: () => 'Denied', search: { status: ['denied'] }, n: (s) => tileFor(s, 'denied')?.count },
  { id: 'pending', label: () => 'Pending', search: { status: ['pending'] }, n: (s) => tileFor(s, 'pending')?.count },
  {
    id: 'paid',
    label: (s) => `Paid · ${month(s)}`,
    title: (s) => `Claims paid in ${month(s)}, as the strip’s Paid tile. Search finds older paid claims.`,
    search: { status: ['paid'] },
    n: (s) => s.paid_month_count,
  },
]

const same = (a: ClaimsSearch, b: ClaimsSearch) => JSON.stringify(filtersOf({ ...a, sort: undefined })) === JSON.stringify(filtersOf({ ...b, sort: undefined }))

export function SavedViews({ search, strip }: { search: ClaimsSearch; strip: StripSummary | undefined }) {
  const views = useViews()
  const save = useSaveView()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <nav aria-label="Views" data-tour="claims-views" className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2 text-sm">
      {QUICK.map((q) => {
        const on = !search.view && same(search, q.search)
        const n = strip && q.n ? q.n(strip) : undefined
        return (
          <Link
            key={q.id}
            to="/claims"
            search={q.search}
            aria-current={on ? 'page' : undefined}
            title={q.title?.(strip)}
            className={cn('rounded-md px-2 py-0.5 no-underline hover:bg-hover', on ? 'bg-hover font-medium text-ink' : 'text-mid')}
          >
            {q.label(strip)}
            {n !== undefined && <span className="ml-1 text-soft">{count(n)}</span>}
          </Link>
        )
      })}
      <span className="mx-1 h-4 border-l border-line" />
      {views.data?.items.map((v) => {
        const parsed = claimsSearchSchema.safeParse(v.search_params)
        if (!parsed.success) return null
        return (
          <Link
            key={v.id}
            to="/claims"
            search={{ ...parsed.data, view: v.id }}
            aria-current={search.view === v.id ? 'page' : undefined}
            className={cn('rounded-md px-2 py-0.5 no-underline hover:bg-hover', search.view === v.id ? 'bg-hover font-medium text-ink' : 'text-mid')}
          >
            {v.name}
          </Link>
        )
      })}
      {naming ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            save.mutate({ name: name.trim(), search_params: filtersOf(search) })
            setNaming(false)
            setName('')
          }}
        >
          <input
            autoFocus
            aria-label="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 w-40 rounded-md border border-line-strong px-2 text-sm focus:outline-2 focus:outline-act"
            placeholder="Name this view"
          />
          <Button size="sm" type="submit" variant="primary" disabled={save.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button type="button" className="ml-1 font-medium text-act hover:underline" onClick={() => setNaming(true)}>
          Save current filter
        </button>
      )}
    </nav>
  )
}
