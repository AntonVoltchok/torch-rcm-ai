/**
 * APPROVE SEAM (D1 phase 2). The claim page approves through this one hook.
 *
 * Today it wraps the existing `useApprove` and shows the run with `?launch=` on this page. After d1-inbox merges,
 * the coordinator replaces the body with the shared `useActiveLaunch` hook (the run owns the pane; Approve is
 * disabled for items on claims under a running launch). Callers use only `{ approve, isPending, isBlocked }`.
 *
 * The swap (feat/d1-inbox @ f8ac24a, `hooks/useActiveLaunch.ts`): `const active = useActiveLaunch()`;
 * `isBlocked: (item) => Boolean(item.claim && active.isLocked(item.claim.id))`; the page shows
 * `active.launchFor(claimId)` in `ProgressPanel` instead of reading `?launch=` itself.
 */
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import type { InboxItem } from '@/api/schema'
import { useApprove } from '@/hooks/useInboxActions'
import { useLaunches } from '@/state/launches'

const route = getRouteApi('/claims/$claimId')

export function useClaimApprove(): { approve: (item: InboxItem) => void; isPending: boolean; isBlocked: (item: InboxItem) => boolean } {
  const navigate = useNavigate({ from: '/claims/$claimId' })
  const search = route.useSearch()
  const launches = useLaunches()
  const m = useApprove({ onLaunched: (l) => void navigate({ search: (s) => ({ ...s, launch: l.id }), replace: true }) })
  const shown = launches.find((l) => l.id === search.launch)
  return {
    approve: (item) => m.mutate({ item }),
    isPending: m.isPending,
    // The run started here is still on screen for this claim: one approval at a time.
    isBlocked: (item) => Boolean(shown?.runs.some((r) => r.claim_id && r.claim_id === item.claim?.id && r.item_id === item.id)),
  }
}
