/** Open inbox items for this claim, at the top: one claim, one queue — approve here or jump to the Inbox. */
import { Link } from '@tanstack/react-router'
import type { ClaimDetail } from '@/api/schema'
import { useApprove } from '@/hooks/useInboxActions'
import { ConfidenceMeter } from '@/components/ConfidenceMeter'
import { TierBadge } from '@/components/TierBadge'
import { Button } from '@/components/ui/Button'
import type { Launch } from '@/state/launches'
import { useCurrentUser } from '@/state/session'

export function OpenItemsPanel({ claim, onLaunched }: { claim: ClaimDetail; onLaunched: (l: Launch) => void }) {
  const approve = useApprove({ onLaunched })
  const user = useCurrentUser()
  const items = claim.open_inbox_items
  return (
    <section aria-label="Open inbox items" className="rounded-lg border border-line bg-fill px-3 py-2">
      <div className="mb-1 text-2xs font-extrabold uppercase tracking-[.05em] text-mid">Open inbox items for this claim ({items.length})</div>
      {items.length === 0 ? (
        <p className="m-0 text-sm text-mid" data-testid="no-open-items">
          Nothing open.{claim.claim.in_flight ? <> ✦ <b className="text-ink">{claim.claim.in_flight}</b></> : null}
        </p>
      ) : (
        <ul className="m-0 list-none p-0">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 py-1">
              {it.confidence && <ConfidenceMeter pct={it.confidence.pct} basis={it.confidence.basis} compact />}
              <span className="font-semibold">{it.recommendation}</span>
              {it.tier ? <TierBadge tier={it.tier} compact /> : null}
              {it.group_key && <span className="text-xs text-mid">· in a group</span>}
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="primary" disabled={approve.isPending || (it.tier === 3 && user.role !== 'owner')} onClick={() => approve.mutate({ item: it })}>
                  Approve & run
                </Button>
                <Link to="/inbox" search={{ item: it.id, group: it.group_key ?? undefined }} className="self-center text-sm font-semibold text-acc no-underline hover:underline">
                  Open in Inbox →
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
