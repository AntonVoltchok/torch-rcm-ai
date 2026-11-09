/**
 * The claim's open item (D1 `.openit`): what the agents propose, why it stopped, what it touches and where the
 * baton lands, with its one action. A drafted note is never sent from here: it is read and sent in the Inbox,
 * where its text and citations are. Tier 3 you can't sign shows who signs. Nothing open: what is in flight.
 */
import { Link } from '@tanstack/react-router'
import type { ClaimDetail, InboxItem } from '@/api/schema'
import { Baton, partyWord } from '@/components/Baton'
import { TierBadge } from '@/components/TierBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { session, USERS } from '@/state/session'
import { useClaimApprove } from './useClaimApprove'

const linkBtn = 'inline-flex h-10 items-center rounded-lg px-4 text-base font-semibold no-underline'

function landsWord(lands: InboxItem['lands'], payer: string): string | null {
  if (!lands || lands === 'nobody') return lands === 'nobody' ? 'Then nobody holds it' : null
  return `Then it is with ${lands === 'payer' ? payer : partyWord(lands)}`
}

function Item({ it, payer }: { it: InboxItem; payer: string }) {
  const approve = useClaimApprove()
  // The server names the signer (`signer_user_id`); the client never guesses one from a role.
  const signer = it.signer_note ? USERS.find((u) => u.id === it.signer_user_id) : undefined
  const lands = landsWord(it.lands, payer)
  return (
    <li className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-[7px] border border-practice-line bg-practice-bg px-4 py-3" data-item-kind={it.kind}>
      <div className="min-w-[260px] flex-1">
        <h2 className="m-0 text-md font-semibold">{it.recommendation}</h2>
        <p className="m-0 mt-0.5 text-sm text-mid">
          {it.title}. {it.stopped_by}
          {it.group_key ? ' Other claims share this decision in the Inbox.' : ''}
        </p>
        {it.touches.length > 0 && (
          <ul aria-label="What this touches" className="m-0 mt-2 list-none p-0 text-sm text-ink">
            {it.touches.map((t) => (
              <li key={t} className="before:mr-1.5 before:text-soft before:content-['–']">
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        {it.signer_note ? (
          <>
            <p className="m-0 max-w-[300px] text-right text-sm text-mid">{it.signer_note}</p>
            <b className="text-sm font-semibold text-practice-ink">{signer ? `${signer.name} signs this` : 'Someone else signs this'}</b>
            {signer && (
              <Button onClick={() => session.set({ userId: signer.id })}>
                Switch to {signer.name} (demo)
              </Button>
            )}
          </>
        ) : it.kind === 'review_draft' ? (
          <Link to="/inbox" search={{ item: it.id, group: it.group_key ?? undefined }} className={cn(linkBtn, 'bg-act text-white hover:bg-act-hover')}>
            Read and send in Inbox
          </Link>
        ) : (
          <span className="flex items-center gap-2">
            <Link to="/inbox" search={{ item: it.id, group: it.group_key ?? undefined }} className="rounded-md px-2 py-1 text-sm text-mid no-underline hover:bg-hover">
              Decide in Inbox
            </Link>
            <Button size="lg" variant="primary" disabled={approve.isPending || approve.isBlocked(it)} onClick={() => approve.approve(it)}>
              {it.action_label ?? 'Approve and run'}
            </Button>
          </span>
        )}
        <span className="flex items-center gap-2 text-xs text-mid">
          {it.tier ? <TierBadge tier={it.tier} compact /> : null}
          {lands && (
            <>
              {it.lands && <Baton who={it.lands} decorative />}
              {lands}
            </>
          )}
        </span>
      </div>
    </li>
  )
}

export function OpenItemsPanel({ claim }: { claim: ClaimDetail }) {
  const items = claim.open_inbox_items
  const payer = claim.payer.short_name
  if (items.length === 0) {
    const flight = claim.claim.in_flight
    return (
      <section aria-label="Open inbox items" className={cn('rounded-[7px] border px-4 py-3', flight ? 'border-agents-line bg-agents-bg' : 'border-line bg-paper')}>
        <p className="m-0 text-sm text-mid" data-testid="no-open-items">
          {flight ? (
            <>
              <b className="text-base font-semibold text-agents-ink">{flight}</b>
              <span className="block">The status does not change until {payer} replies. Nothing here waits on you.</span>
            </>
          ) : (
            <>Nothing open. {claim.claim.move.label ? `${claim.claim.move.label}.` : ''}</>
          )}
        </p>
      </section>
    )
  }
  return (
    <section aria-label="Open inbox items">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((it) => (
          <Item key={it.id} it={it} payer={payer} />
        ))}
      </ul>
    </section>
  )
}
