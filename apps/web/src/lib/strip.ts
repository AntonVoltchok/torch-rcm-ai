/**
 * Selectors over GET /summary/strip. Every number shown on the pipeline strip, the nav badges and the
 * Claims header is a server field read here (`open_count`, `ar_cents`, `flagged_count`, tiles): nothing is
 * added up or counted on the client.
 */
import type { ClaimStatus, StripSummary, StripTile } from '@/api/schema'

/** Strip order as read in docs/spec/06-demo-script.md step 1 (claim lifecycle, Paid last). */
export const STRIP_ORDER: readonly ClaimStatus[] = ['ready', 'sent', 'rejected', 'accepted', 'pending', 'denied', 'partial', 'appealed', 'paid']

export interface TileView extends StripTile {
  /** For `paid`, the month's numbers replace the all-time group (the strip says "Paid · Oct"). */
  label: string
}

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  ready: 'Ready',
  sent: 'Sent',
  rejected: 'Rejected',
  accepted: 'Accepted',
  pending: 'Pending',
  denied: 'Denied',
  partial: 'Partial',
  paid: 'Paid',
  appealed: 'Appealed',
}

/** The server's tile for a status. The server sends all nine; a missing one is `undefined`, never an invented 0. */
export function tileFor(strip: StripSummary, status: ClaimStatus): StripTile | undefined {
  return strip.tiles.find((t) => t.status === status)
}

/** The tiles in strip order. A status the server didn't send is left out rather than drawn as 0. */
export function stripTiles(strip: StripSummary): TileView[] {
  return STRIP_ORDER.flatMap((status) => {
    const tile = tileFor(strip, status)
    if (!tile) return []
    if (status === 'paid') {
      return { ...tile, count: strip.paid_month_count, cents: strip.paid_month_cents, label: `Paid · ${strip.paid_month_label}` }
    }
    return { ...tile, label: STATUS_LABEL[status] }
  })
}

export type NavBadgeKey = 'inbox' | 'payments' | 'eligibility' | 'activity'
export function navBadge(strip: StripSummary | undefined, key: NavBadgeKey): number | null {
  if (!strip) return null
  if (key === 'inbox') return strip.inbox_open
  return strip.nav_badges[key]
}
