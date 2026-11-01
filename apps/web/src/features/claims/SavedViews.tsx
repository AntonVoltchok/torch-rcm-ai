/**
 * Quick views (fixed filters, counts from the strip) and saved views (server, GET/POST /views).
 * Applying a view navigates: the URL stays the only filter state, `view` just remembers which one.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { StripSummary } from '@/api/schema'
import { useSaveView, useViews } from '@/hooks/useClaims'
import { flaggedTotal, openTotals, tileFor } from '@/lib/strip'
import { count } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { claimsSearchSchema, filtersOf, type ClaimsSearch } from './search'

type Quick = { id: string; label: string; search: ClaimsSearch; n: (s: StripSummary) => number }
const QUICK: Quick[] = [
  { id: 'all', label: 'All', search: {}, n: (s) => openTotals(s).count + s.paid_month_count },
  { id: 'flag', label: '⚑ Needs action', search: { flag: true }, n: flaggedTotal },
  { id: 'rejected', label: 'Rejected', search: { status: ['rejected'] }, n: (s) => tileFor(s, 'rejected').count },
  { id: 'denied', label: 'Denied', search: { status: ['denied'] }, n: (s) => tileFor(s, 'denied').count },
  { id: 'pending', label: 'Pending', search: { status: ['pending'] }, n: (s) => tileFor(s, 'pending').count },
  { id: 'paid', label: 'Paid', search: { status: ['paid'] }, n: (s) => s.paid_month_count },
]

const same = (a: ClaimsSearch, b: ClaimsSearch) => JSON.stringify(filtersOf({ ...a, sort: undefined })) === JSON.stringify(filtersOf({ ...b, sort: undefined }))

export function SavedViews({ search, strip }: { search: ClaimsSearch; strip: StripSummary | undefined }) {
  const views = useViews()
  const save = useSaveView()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line px-3.5 py-2 text-sm">
      {QUICK.map((q) => {
        const on = !search.view && same(search, q.search)
        return (
          <Link
            key={q.id}
            to="/claims"
            search={q.search}
            className={cn('rounded-xl px-2.5 py-0.5 no-underline', on ? 'bg-ink font-semibold text-white' : 'text-mid hover:text-ink')}
          >
            {q.label}
            {strip ? ` ${count(q.n(strip))}` : ''}
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
            className={cn('rounded-xl px-2.5 py-0.5 no-underline', search.view === v.id ? 'bg-ink font-semibold text-white' : 'text-mid hover:text-ink')}
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
          <input autoFocus aria-label="View name" value={name} onChange={(e) => setName(e.target.value)} className="w-40 rounded border border-line px-2 py-0.5" placeholder="Name this view" />
          <Button size="sm" type="submit" variant="primary" disabled={save.isPending}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <button type="button" className="font-semibold text-acc hover:underline" onClick={() => setNaming(true)}>
          ＋ Save current filter
        </button>
      )}
    </div>
  )
}
