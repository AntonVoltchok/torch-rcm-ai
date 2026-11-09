import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { LOCATIONS, session, useSession, type LocationId } from '@/state/session'

/**
 * Search (→ /claims?q=) and the location switcher. Location is tenant scope, not a filter: it lives in
 * localStorage and is part of every list query key, so it survives navigation the way a signed-in practice would.
 * The clock lives in the sidebar foot.
 */
export function TopBarControls() {
  const navigate = useNavigate()
  const { locationId } = useSession()
  const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-2">
      <form
        role="search"
        className="relative"
        onSubmit={(e) => {
          e.preventDefault()
          const term = q.trim()
          if (term) void navigate({ to: '/claims', search: { q: term } })
        }}
      >
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 fill-none stroke-soft"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-1.2 3.3 3.2 3.2" />
        </svg>
        <input
          aria-label="Search claims and patients"
          placeholder="Search claims, patients…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 w-[200px] rounded-lg border border-line-strong bg-paper pl-8 pr-2.5 text-sm placeholder:text-soft"
        />
      </form>
      <select
        aria-label="Location"
        value={locationId}
        onChange={(e) => session.set({ locationId: e.target.value as LocationId })}
        className="h-8 rounded-lg border border-line-strong bg-paper px-2 text-sm text-mid"
      >
        {LOCATIONS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  )
}
