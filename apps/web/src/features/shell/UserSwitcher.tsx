import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { session, USERS, useCurrentUser, type DemoUser } from '@/state/session'

/**
 * Demo-only "log in as". Switching user changes the X-Torch-User header, so every cached read is
 * someone else's view: reset the cache and re-run route guards (an open /cash redirects for Dana).
 */
export function UserSwitcher() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  const router = useRouter()
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-[.05em] text-soft">Signed in as (demo)</span>
      <select
        aria-label="Switch user"
        value={user.id}
        className="rounded border border-line bg-white px-1.5 py-1 text-[12.5px] font-bold text-ink"
        onChange={(e) => {
          session.set({ userId: e.target.value as DemoUser['id'] })
          void qc.resetQueries()
          void router.invalidate()
        }}
      >
        {USERS.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.title}
          </option>
        ))}
      </select>
      <span>Harbor Dental</span>
    </label>
  )
}
