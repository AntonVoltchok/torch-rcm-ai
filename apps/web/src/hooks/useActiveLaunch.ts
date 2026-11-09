/**
 * Which claims are under a run this tab launched that has not ended. Shared by the Inbox and the Claim page:
 * while a launch runs, Approve is disabled only for items on those claims (J/K, Next and every other item stay live).
 *
 * A run's status is the server's (`['run', id]`). The panel that shows a run streams it over SSE, but the user may
 * move on before it ends, so this hook also polls each run it does not yet know to be over, and when it sees one end
 * it refreshes what the run can have changed (the same invalidation the stream does on `done`). A run whose status is
 * not loaded yet counts as running: Approve unlocks on the server's word, never on a guess.
 */
import { useEffect, useRef } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { ClaimSummary, RunStatus } from '@/api/schema'
import { invalidateAfterRun, runQueryOptions } from '@/hooks/useRun'
import { isTerminal } from '@/lib/runEvents'
import { useLaunches, type Launch } from '@/state/launches'

export interface ActiveLaunches {
  /** Status of every run this tab launched; undefined until the server has answered. */
  statusOf: (runId: string) => RunStatus | undefined
  /** True while any run of the launch has not ended. */
  isRunning: (launch: Launch) => boolean
  /** The running launch that holds this claim, if any. */
  launchFor: (claimId: string | null | undefined) => Launch | undefined
  /** Approve is locked for an item on this claim. */
  isLocked: (claimId: string | null | undefined) => boolean
  /**
   * Why actions on an item for this claim are locked, or null. Locked when the server says the agents hold the claim
   * (`move.who === 'agents'`: a queued, running or paused run, from any tab or rule) or this tab has a run on it that
   * has not ended. The reason is the server's `move.label` when it has one.
   */
  lockFor: (claim: ClaimSummary | null | undefined) => { reason: string } | null
}

export function useActiveLaunch(): ActiveLaunches {
  const qc = useQueryClient()
  const launches = useLaunches()
  const runIds = launches.flatMap((l) => l.runs.map((r) => r.run_id))
  const runs = useQueries({
    queries: runIds.map((id) => ({
      ...runQueryOptions(id),
      refetchInterval: (q: { state: { data?: { status: RunStatus } | undefined } }) => (q.state.data && isTerminal(q.state.data.status) ? false : 1500),
    })),
  })
  const statuses = runs.map((r) => r.data?.status)

  // Seen here go from running to over: refresh what the run changed (the SSE path does the same on `done`).
  const seen = useRef(new Map<string, RunStatus | undefined>())
  const key = runIds.map((id, i) => `${id}:${statuses[i] ?? ''}`).join(',')
  useEffect(() => {
    runIds.forEach((id, i) => {
      const now = statuses[i]
      const before = seen.current.get(id)
      if (before !== undefined && !isTerminal(before) && now !== undefined && isTerminal(now)) invalidateAfterRun(qc, id, { refetchRun: false })
      seen.current.set(id, now)
    })
    // `key` stands for runIds + statuses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, qc])

  const statusOf = (runId: string) => statuses[runIds.indexOf(runId)]
  const isRunning = (l: Launch) =>
    l.runs.some((r) => {
      const s = statusOf(r.run_id)
      return s === undefined || !isTerminal(s)
    })
  const launchFor = (claimId: string | null | undefined) =>
    claimId ? launches.find((l) => isRunning(l) && l.runs.some((r) => r.claim_id === claimId && !isOver(statusOf(r.run_id)))) : undefined
  const lockFor = (claim: ClaimSummary | null | undefined) => {
    if (!claim) return null
    if (claim.move.who === 'agents') return { reason: `${claim.move.label || 'With the agents'} on #${claim.number}` }
    return launchFor(claim.id) ? { reason: `Agents are working on #${claim.number}` } : null
  }
  return { statusOf, isRunning, launchFor, isLocked: (claimId) => launchFor(claimId) !== undefined, lockFor }
}

const isOver = (s: RunStatus | undefined) => s !== undefined && isTerminal(s)
