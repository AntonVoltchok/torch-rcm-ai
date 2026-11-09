/**
 * Which tour belongs to which screen. Built from nav.ts, so a screen added to the sidebar without a tour fails the
 * registry test instead of silently having none. Claim detail (/claims/<id>) has its own tour.
 */
import type { Role } from '@/api/schema'
import { NAV, navFor } from '@/features/shell/nav'
import type { TourId } from './types'

export const NAV_TOUR: Record<(typeof NAV)[number]['to'], TourId> = {
  '/inbox': 'inbox',
  '/denials': 'denials',
  '/ledger': 'ledger',
  '/claims': 'claims',
  '/payments': 'payments',
  '/patients': 'patients',
  '/eligibility': 'eligibility',
  '/activity': 'activity',
  '/cash': 'cash',
  '/settings/agents': 'settings',
}

export function tourForPath(pathname: string): TourId | null {
  if (/^\/claims\/[^/]+$/.test(pathname)) return 'claim'
  const hit = NAV.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`))
  // /denials/<id> is the appeal workbench (a design frame), not the worklist the Denials tour walks.
  if (!hit || (hit.to === '/denials' && pathname !== '/denials')) return null
  return NAV_TOUR[hit.to]
}

/** The screen tours this role can take: the screens its sidebar shows, plus claim detail. */
export function toursFor(role: Role): TourId[] {
  const screens = navFor(role).map((n) => NAV_TOUR[n.to])
  const claims = screens.indexOf('claims')
  return claims === -1 ? screens : [...screens.slice(0, claims + 1), 'claim', ...screens.slice(claims + 1)]
}
