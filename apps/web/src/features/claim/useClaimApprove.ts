/**
 * The claim page approves through this one hook. The run it starts is shown from `?launch=`, so the outcome stays on
 * screen after the run ends. Approve is locked by the same rule as the Inbox (`useActiveLaunch`): while the agents
 * hold the claim, or a run this tab started on it has not ended.
 */
import { useNavigate } from '@tanstack/react-router'
import type { InboxItem } from '@/api/schema'
import { useActiveLaunch } from '@/hooks/useActiveLaunch'
import { useApprove } from '@/hooks/useInboxActions'

export function useClaimApprove(): { approve: (item: InboxItem) => void; isPending: boolean; isBlocked: (item: InboxItem) => boolean } {
  const navigate = useNavigate({ from: '/claims/$claimId' })
  const active = useActiveLaunch()
  const m = useApprove({ onLaunched: (l) => void navigate({ search: (s) => ({ ...s, launch: l.id }), replace: true }) })
  return {
    approve: (item) => m.mutate({ item }),
    isPending: m.isPending,
    isBlocked: (item) => active.lockFor(item.claim) !== null,
  }
}
