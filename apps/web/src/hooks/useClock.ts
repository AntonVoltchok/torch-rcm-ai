/**
 * The demo's frozen server clock, and the owner-only "skip ahead" control.
 * `POST /clock/advance` is async (202 {advance_id}); progress arrives as `event: advance` on the firehose
 * (written into `['advance', id]` by useFirehose) with `GET /clock/advance/{id}` polling as the fallback.
 */
import { useEffect, useRef } from 'react'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { isApiError } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { AdvanceSnapshot } from '@/api/schema'
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

/**
 * ['advance', id]: written by the firehose's `event: advance`, polled from GET /clock/advance/{id} only while the
 * firehose is not live. Either source can be the one that says `done`.
 */
export function useAdvanceProgress(advanceId: string | undefined) {
  const firehose = useFirehoseState()
  return useQuery({
    queryKey: qk.advance(advanceId ?? 'none'),
    queryFn: () => api.advanceStatus(advanceId ?? ''),
    enabled: Boolean(advanceId),
    refetchInterval: (q) => (q.state.data?.done || firehose === 'live' ? false : 1000),
  })
}

/** Events fired so far: a count while running (firehose), the full list when done (or on every poll). */
export function advanceEvents(s: AdvanceSnapshot | undefined): number {
  if (!s) return 0
  return Array.isArray(s.events_fired) ? s.events_fired.length : s.events_fired
}

/**
 * When an advance finishes — whichever channel reported it — the scheduler has moved the whole practice
 * forward, so every cached read is stale: `invalidateQueries()` once per advance id, then say what happened.
 */
export function useAdvanceCompletion(advanceId: string | undefined, snapshot: AdvanceSnapshot | undefined) {
  const qc = useQueryClient()
  const handled = useRef<string | null>(null)
  const done = snapshot?.done === true && snapshot.advance_id === advanceId
  useEffect(() => {
    if (!advanceId || !done || handled.current === advanceId) return
    handled.current = advanceId
    void qc.invalidateQueries()
    if (snapshot?.state === 'failed' || snapshot?.error) toast(`The clock advance stopped: ${snapshot.error ?? 'failed'}.`, { tone: 'bad' })
    else toast(`Clock advanced · ${advanceEvents(snapshot)} events fired.`, { tone: 'ok' })
  }, [advanceId, done, qc, snapshot])
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
