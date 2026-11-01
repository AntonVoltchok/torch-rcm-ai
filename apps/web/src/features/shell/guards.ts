/**
 * Route guards read the same role table as the nav. They are UX only; the API enforces roles (403).
 * Returns true when the current user may NOT see `path` (and tells them why); the route then redirects.
 */
import { session } from '@/state/session'
import { toast } from '@/state/toast'
import { allowed, type NavItem } from './nav'

export function deniedWithToast(path: NavItem['to'], label: string, why?: string): boolean {
  const user = session.user()
  if (allowed(path, user.role)) return false
  toast(`${why ?? `${label} is owner-only.`} Switch to Dr. Morgan in the sidebar to see it.`, { tone: 'warn' })
  return true
}
