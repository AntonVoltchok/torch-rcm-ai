/**
 * A run's live view. `['run', id]` is fetched once (the snapshot, with `last_event_id`), then patched by
 * SSE events through the pure reducer in lib/runEvents.ts. Reconnects send `Last-Event-ID`, so the
 * server replays only what we missed; a reload refetches the snapshot and resubscribes from it. After
 * three failed connects the hook stops streaming and polls GET /runs/{id} every 2 s instead.
 */
import { useEffect, useState } from 'react'
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { API_BASE } from '@/env'
import { api, sseUrl } from '@/api/endpoints'
import { authHeaders } from '@/api/client'
import { qk } from '@/api/queryKeys'
import { RunDoneEvent, RunStatusEvent, RunStepEvent, StripSummary, type Run } from '@/api/schema'
import { applyDoneEvent, applyStatusEvent, applyStepEvent, isTerminal, mergeSnapshot } from '@/lib/runEvents'
import { backoffMs, connectSse, type SseMessage } from '@/lib/sse'
import { session } from '@/state/session'

export type StreamMode = 'sse' | 'poll' | 'idle'

/** Shared by every observer of ['run', id]: a write (snapshot or SSE patch) never moves the view backwards. */
export const runQueryOptions = (runId: string) =>
  queryOptions({
    queryKey: qk.run(runId),
    queryFn: () => api.run(runId),
    structuralSharing: (old: unknown, next: unknown) => mergeSnapshot(old as Run | undefined, next as Run),
    staleTime: Infinity,
  })

function invalidateAfterRun(qc: QueryClient, run: Run | undefined) {
  void qc.invalidateQueries({ queryKey: qk.inbox.all })
  void qc.invalidateQueries({ queryKey: qk.claims.all })
  void qc.invalidateQueries({ queryKey: qk.activityAll })
  void qc.invalidateQueries({ queryKey: qk.preview })
  void qc.invalidateQueries({ queryKey: qk.agents })
  if (run?.claim_id) void qc.invalidateQueries({ queryKey: qk.claim(run.claim_id) })
}

/** Exported for tests: fold one SSE message into the cache. Returns true when the stream is finished. */
export function handleRunMessage(qc: QueryClient, runId: string, msg: SseMessage): boolean {
  let data: unknown
  try {
    data = JSON.parse(msg.data) as unknown
  } catch {
    return false
  }
  const patch = (fn: (r: Run) => Run) => {
    qc.setQueryData<Run>(qk.run(runId), (old) => (old ? fn(old) : old))
  }
  switch (msg.event) {
    case 'step': {
      const ev = RunStepEvent.safeParse(data)
      if (!ev.success) return false
      patch((r) => applyStepEvent(r, ev.data, msg.id))
      // `decide` carries the agent's label and rationale on the stored run: fetch them once.
      if (ev.data.policy_verdict) void qc.invalidateQueries({ queryKey: qk.run(runId) })
      return false
    }
    case 'status': {
      const ev = RunStatusEvent.safeParse(data)
      if (ev.success) patch((r) => applyStatusEvent(r, ev.data, msg.id))
      return false
    }
    case 'counts': {
      const ev = StripSummary.safeParse(data)
      if (ev.success) qc.setQueryData(qk.strip(session.locationParam()), ev.data)
      return false
    }
    case 'done': {
      const ev = RunDoneEvent.safeParse(data)
      patch((r) => applyDoneEvent(r, ev.success ? ev.data : {}, msg.id))
      invalidateAfterRun(qc, qc.getQueryData<Run>(qk.run(runId)))
      return true
    }
    default:
      return false
  }
}

export function useRun(runId: string | undefined): { run: Run | undefined; mode: StreamMode; error: unknown } {
  const qc = useQueryClient()
  const [mode, setMode] = useState<StreamMode>('idle')

  const query = useQuery({
    ...runQueryOptions(runId ?? 'none'),
    enabled: Boolean(runId),
    refetchInterval: (q) => (mode === 'poll' && q.state.data && !isTerminal(q.state.data.status) ? 2000 : false),
  })

  const hasSnapshot = query.data !== undefined
  const terminal = query.data ? isTerminal(query.data.status) : false

  useEffect(() => {
    if (!runId || !hasSnapshot || terminal) return
    const ctrl = new AbortController()
    let attempt = 0
    void (async () => {
      while (!ctrl.signal.aborted) {
        const cached = qc.getQueryData<Run>(qk.run(runId))
        if (cached && isTerminal(cached.status)) break
        let finished = false
        try {
          await connectSse({
            url: `${API_BASE}${sseUrl.runEvents(runId)}`,
            headers: authHeaders(),
            lastEventId: cached?.last_event_id ?? null,
            signal: ctrl.signal,
            onOpen: () => {
              attempt = 0
              setMode('sse')
            },
            onMessage: (msg) => {
              if (handleRunMessage(qc, runId, msg)) finished = true
            },
          })
        } catch {
          attempt++
          if (attempt >= 3) {
            setMode('poll')
            return
          }
        }
        if (finished || ctrl.signal.aborted) break
        await new Promise((r) => setTimeout(r, backoffMs(attempt)))
      }
      if (!ctrl.signal.aborted) setMode('idle')
    })()
    return () => {
      ctrl.abort()
    }
  }, [qc, runId, hasSnapshot, terminal])

  // Polling fallback has no `done` event: do the same invalidation when the snapshot turns terminal.
  useEffect(() => {
    if (mode === 'poll' && terminal) invalidateAfterRun(qc, query.data)
  }, [mode, terminal, qc, query.data])

  return { run: query.data, mode, error: query.error }
}
