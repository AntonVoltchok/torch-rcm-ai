/** Agents runtime: "5 agents · 1 running", the paused chip, and the owner's kill switch. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { useFirehoseState } from '@/state/live'
import { toast } from '@/state/toast'

export function useAgentsStatus() {
  const firehose = useFirehoseState()
  return useQuery({
    queryKey: qk.agents,
    queryFn: api.agentsStatus,
    staleTime: 10_000,
    // The firehose invalidates this on every run change; poll only when it is down.
    refetchInterval: firehose === 'down' ? 5000 : false,
  })
}

export function useAgentsKillSwitch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pause: boolean) => (pause ? api.pauseAgents() : api.resumeAgents()),
    onSuccess: (_d, pause) => {
      toast(pause ? 'Agents paused. Running runs stop at the next step.' : 'Agents resumed.', { tone: pause ? 'warn' : 'ok' })
    },
    onError: () => {
      toast('Only the practice owner can pause or resume agents.', { tone: 'bad' })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.agents }),
  })
}
