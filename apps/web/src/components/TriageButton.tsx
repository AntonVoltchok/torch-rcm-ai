import type { ClaimDetail } from '@/api/schema'
import { useTriage } from '@/hooks/useClaims'
import { useAgentsStatus } from '@/hooks/useAgents'
import { userName } from '@/features/settings/selectors'
import type { Launch } from '@/state/launches'
import { Button } from './ui/Button'

/** "Ask Follow-up to look" → POST /claims/{id}:triage (manual triage run). Disabled with a reason, never hidden. */
export function TriageButton({ claim: detail, onLaunched }: { claim: ClaimDetail; onLaunched: (l: Launch) => void }) {
  const { claim, patient, open_inbox_items } = detail
  const triage = useTriage({ onLaunched })
  const agents = useAgentsStatus()
  const reason = agents.data?.paused
    ? `Agents are paused${agents.data.paused_by ? ` by ${userName(agents.data.paused_by)}` : ''}.`
    : open_inbox_items.length > 0
      ? 'This claim already has an open Inbox item.'
      : claim.in_flight
        ? `An agent action is in flight: ${claim.in_flight}.`
        : null
  return (
    <Button
      onClick={() => triage.mutate({ claimId: claim.id, number: claim.number, patient: patient.display_name })}
      disabled={Boolean(reason) || triage.isPending}
      title={reason ?? 'Starts a Follow-up triage run on this claim. Anything it proposes comes to the Inbox.'}
    >
      ✦ Ask Follow-up to look
    </Button>
  )
}
