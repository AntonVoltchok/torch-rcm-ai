import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { session, USERS, useCurrentUser, type DemoUser } from '@/state/session'

/**
 * Demo-only "log in as". Switching user changes the X-Torch-User header, so every cached read is
 * someone else's view: reset the cache and re-run route guards (an open /cash redirects for Dana).
 * A native select in D1's segmented well: four people don't fit as segments, and the role stays visible
 * because the product turns on it ("Dr. Morgan signs").
 */
const ROLE: Record<DemoUser['role'], string> = { owner: 'Owner', billing: 'Billing', dentist: 'Dentist', front_desk: 'Front desk' }

export function UserSwitcher() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  const router = useRouter()
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-soft">Signed in as (demo)</span>
      <span className="relative rounded-[7px] bg-hover p-0.5">
        <select
          aria-label="Switch user"
          value={user.id}
          title={`${user.name}, ${user.title}`}
          className="w-full appearance-none rounded-[5px] bg-paper py-1 pl-2 pr-6 text-sm font-medium text-ink shadow-[0_0_0_1px_var(--color-line),var(--shadow-panel)]"
          onChange={(e) => {
            session.set({ userId: e.target.value as DemoUser['id'] })
            void qc.resetQueries()
            void router.invalidate()
          }}
        >
          {USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {ROLE[u.role]}
            </option>
          ))}
        </select>
        <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 fill-none stroke-soft" strokeWidth={1.5}>
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </span>
    </label>
  )
}
