import { useEffect, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { CLAIM_STATUSES, PayerKey, type ClaimStatus } from '@/api/schema'
import { PAYER_NAME } from '@/lib/payers'
import { STATUS_LABEL } from '@/lib/strip'
import { cn } from '@/lib/cn'
import { AGE_BUCKETS, AGE_LABEL, AgeBucket, type ClaimsSearch } from './search'

const route = getRouteApi('/claims/')
const PROVIDERS = ['Dr. Morgan', 'Dr. Lee', 'RDH M. Cole']

/** Every control writes the URL (replace, so typing doesn't flood history); nothing is held locally but the search box draft. */
export function ClaimsFilters() {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/claims/' })
  const set = (patch: Partial<ClaimsSearch>) => void navigate({ search: (s) => ({ ...s, ...patch, view: undefined, row: undefined }), replace: true })
  const [q, setQ] = useState(search.q ?? '')
  useEffect(() => setQ(search.q ?? ''), [search.q])
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? '') !== q) set({ q: q || undefined })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const statuses = search.status ?? []
  const toggle = (s: ClaimStatus) => set({ status: statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s] })
  const select = 'rounded-md border border-line bg-white px-2 py-0.5 text-sm text-mid'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2 text-sm">
      <input aria-label="Filter claims" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Claim #, patient, ICN" className="w-44 rounded-md border border-line px-2 py-0.5" />
      <select aria-label="Payer" className={select} value={search.payer ?? ''} onChange={(e) => set({ payer: PayerKey.safeParse(e.target.value).data })}>
        <option value="">Payer: All</option>
        {PayerKey.options.map((p) => (
          <option key={p} value={p}>
            {PAYER_NAME[p]}
          </option>
        ))}
      </select>
      <select aria-label="Provider" className={select} value={search.provider ?? ''} onChange={(e) => set({ provider: e.target.value || undefined })}>
        <option value="">Provider: All</option>
        {PROVIDERS.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <select aria-label="Age" className={select} value={search.age ?? ''} onChange={(e) => set({ age: AgeBucket.safeParse(e.target.value).data })}>
        <option value="">Age: All</option>
        {AGE_BUCKETS.map((a) => (
          <option key={a} value={a}>
            {AGE_LABEL[a]}
          </option>
        ))}
      </select>
      <label className="inline-flex items-center gap-1 text-mid">
        <input type="checkbox" checked={search.flag === true} onChange={(e) => set({ flag: e.target.checked || undefined })} />⚑ Needs action
      </label>
      <div role="group" aria-label="Status" className="flex flex-wrap gap-1">
        {CLAIM_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={statuses.includes(s)}
            onClick={() => toggle(s)}
            className={cn('rounded-[10px] border px-2 text-2xs font-semibold leading-[18px]', statuses.includes(s) ? 'border-acc bg-acc-bg text-acc' : 'border-line bg-white text-mid')}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      {(statuses.length > 0 || search.payer || search.provider || search.age || search.flag || search.q) && (
        <button type="button" className="ml-auto font-semibold text-acc hover:underline" onClick={() => void navigate({ search: { sort: search.sort }, replace: true })}>
          Clear filters
        </button>
      )}
    </div>
  )
}
