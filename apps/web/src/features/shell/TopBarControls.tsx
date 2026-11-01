import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useNow } from '@/hooks/useClock'
import { clockLabel } from '@/lib/format'
import { LOCATIONS, session, useSession, type LocationId } from '@/state/session'

/** Search (→ /claims?q=), location switcher (localStorage, part of every list query key), server clock. */
export function TopBarControls() {
  const navigate = useNavigate()
  const { locationId } = useSession()
  const now = useNow()
  const [q, setQ] = useState('')
  return (
    <div className="flex items-center gap-2.5">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          const term = q.trim()
          if (term) void navigate({ to: '/claims', search: { q: term } })
        }}
      >
        <input
          aria-label="Search claims and patients"
          placeholder="Search claims, patients…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-[190px] rounded-md border border-line bg-white px-2.5 py-1 text-sm placeholder:text-soft"
        />
      </form>
      <select
        aria-label="Location"
        value={locationId}
        onChange={(e) => session.set({ locationId: e.target.value as LocationId })}
        className="rounded-md border border-line bg-white px-2 py-1 text-sm text-mid"
      >
        {LOCATIONS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <span className="whitespace-nowrap rounded-md border border-line bg-white px-2 py-1 text-sm text-mid" title="Frozen demo clock (server time)">
        {clockLabel(now)}
      </span>
    </div>
  )
}
