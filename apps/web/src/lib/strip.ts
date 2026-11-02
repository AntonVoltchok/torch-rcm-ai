/**
 * Selectors over GET /summary/strip. Every number shown on the pipeline strip, the nav badges and the
 * Claims header is read from the server's tiles here: we add server-computed tile values, we never count
 * claims on the client.
 */
import type { ClaimStatus, StripSummary, StripTile } from '@/api/schema'

/** Strip order as read in docs/spec/06-demo-script.md step 1 (claim lifecycle, Paid last). */
export const STRIP_ORDER: readonly ClaimStatus[] = ['ready', 'sent', 'rejected', 'accepted', 'pending', 'denied', 'partial', 'appealed', 'paid']

/** Statuses that make up insurance A/R: sent to a payer, not yet closed. */
export const AR_STATUSES: readonly ClaimStatus[] = ['sent', 'rejected', 'accepted', 'pending', 'denied', 'appealed', 'partial']

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

export function tileFor(strip: StripSummary, status: ClaimStatus): StripTile {
  return strip.tiles.find((t) => t.status === status) ?? { status, count: 0, cents: 0, flagged: 0, cents_basis: 'billed', label: STATUS_LABEL[status] }
}

export function stripTiles(strip: StripSummary): TileView[] {
  return STRIP_ORDER.map((status) => {
    const tile = tileFor(strip, status)
    if (status === 'paid') {
      return { ...tile, count: strip.paid_month_count, cents: strip.paid_month_cents, label: `Paid · ${strip.paid_month_label}` }
    }
    return { ...tile, label: STATUS_LABEL[status] }
  })
}

function sum(tiles: StripTile[], pick: (t: StripTile) => number): number {
  return tiles.reduce((acc, t) => acc + pick(t), 0)
}

/** "107 open" — every status except paid. */
export function openTotals(strip: StripSummary): { count: number; cents: number } {
  const open = strip.tiles.filter((t) => t.status !== 'paid')
  return { count: sum(open, (t) => t.count), cents: sum(open, (t) => t.cents) }
}

/** "$75,500 in A/R" — sent to a payer and not closed. */
export function arTotals(strip: StripSummary): { count: number; cents: number } {
  const ar = strip.tiles.filter((t) => AR_STATUSES.includes(t.status))
  return { count: sum(ar, (t) => t.count), cents: sum(ar, (t) => t.cents) }
}

/** "⚑ 9 claims need action" — the flag cuts across statuses. */
export function flaggedTotal(strip: StripSummary): number {
  return sum(strip.tiles, (t) => t.flagged)
}

export type NavBadgeKey = 'inbox' | 'payments' | 'eligibility' | 'activity'
export function navBadge(strip: StripSummary | undefined, key: NavBadgeKey): number | null {
  if (!strip) return null
  if (key === 'inbox') return strip.inbox_open
  return strip.nav_badges[key]
}
