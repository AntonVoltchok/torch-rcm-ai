/**
 * The demo's frozen server clock, and the owner-only "skip ahead" control.
 * `POST /clock/advance` is async (202 {advance_id}); progress arrives as `event: advance` on the firehose
 * (written into `['advance', id]` by useFirehose) with `GET /clock/advance/{id}` polling as the fallback.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { isApiError } from '@/api/client'
import { qk } from '@/api/queryKeys'
import { useFirehoseState } from '@/state/live'
import { toast } from '@/state/toast'

export const clockQuery = queryOptions({ queryKey: qk.clock, queryFn: api.clock, staleTime: Infinity })

export function useClock() {
  return useQuery(clockQuery)
}

/** The server's "now" as an ISO string, or undefined while loading. Never the browser's wall clock. */
export function useNow(): string | undefined {
  return useClock().data?.now
}

export function useAdvanceProgress(advanceId: string | undefined) {
  const firehose = useFirehoseState()
  return useQuery({
    queryKey: qk.advance(advanceId ?? 'none'),
    queryFn: () => api.advanceStatus(advanceId ?? ''),
    enabled: Boolean(advanceId),
    refetchInterval: (q) => (q.state.data?.done || firehose === 'live' ? false : 1000),
  })
}

export function useAdvanceClock() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (to: string) => api.advanceClock({ to }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.clock })
    },
    onError: (err) => {
      toast(isApiError(err, 'advance_in_progress') ? 'The clock is already advancing.' : 'Could not advance the clock.', { tone: 'bad' })
    },
  })
}

export function useResetDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.resetClock,
    onSuccess: async () => {
      qc.removeQueries()
      await qc.invalidateQueries()
      toast('Demo reset to Wed 10/28 10:40.', { tone: 'ok' })
    },
  })
}
