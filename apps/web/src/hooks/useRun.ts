/**
 * A run's live view. `['run', id]` is fetched once (the snapshot, with `last_event_id`), then patched by
 * SSE events through the pure reducer in lib/runEvents.ts. Reconnects send `Last-Event-ID`, so the
 * server replays only what we missed; a reload refetches the snapshot and resubscribes from it. After
 * three failed connects the hook stops streaming and polls GET /runs/{id} every 2 s instead.
 *
 * GET /runs/{id} returns `RunDetail {run, evidence, last_event_id}`; the cache holds it flattened as a
 * RunView (lib/runEvents.ts `runViewOf`). A `done` frame that fails to parse never implies an outcome: the
 * stream is marked `desynced`, ['run', id] is refetched and polled until the server's Run.status is terminal.
 */
import { useEffect, useState } from 'react'
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { API_BASE } from '@/env'
import { api, sseUrl } from '@/api/endpoints'
import { authHeaders } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { RunView } from '@/api/schema'
import { isTerminal, mergeSnapshot, reduceRunMessage, runViewOf, type RunMessageEffect } from '@/lib/runEvents'
import { backoffMs, connectSse, type SseMessage } from '@/lib/sse'
import { session } from '@/state/session'

/** `desynced`: the stream ended on a frame we could not read; the view polls the server until it is terminal. */
export type StreamMode = 'sse' | 'poll' | 'desynced' | 'idle'

/** What one SSE message did to the stream: keep reading, finished cleanly, or finished unreadably. */
export type RunMessageResult = RunMessageEffect['result']

/** Shared by every observer of ['run', id]: a write (snapshot or SSE patch) never moves the view backwards. */
export const runQueryOptions = (runId: string) =>
  queryOptions({
    queryKey: qk.run(runId),
    queryFn: async () => runViewOf(await api.run(runId)),
    structuralSharing: (old: unknown, next: unknown) => mergeSnapshot(old as RunView | undefined, next as RunView),
    staleTime: Infinity,
  })

/**
 * After a run ends: the run itself (its server status is the truth: `staleTime` is Infinity, so nothing else
 * would refetch it), then everything it can have changed. Polling already holds the server's run, so it skips it.
 */
function invalidateAfterRun(qc: QueryClient, runId: string, opts: { refetchRun: boolean }) {
  if (opts.refetchRun) void qc.invalidateQueries({ queryKey: qk.run(runId) })
  const run = qc.getQueryData<RunView>(qk.run(runId))
  void qc.invalidateQueries({ queryKey: qk.stripAll })
  void qc.invalidateQueries({ queryKey: qk.inbox.all })
  void qc.invalidateQueries({ queryKey: qk.claims.all })
  void qc.invalidateQueries({ queryKey: qk.activityAll })
  void qc.invalidateQueries({ queryKey: qk.preview })
  void qc.invalidateQueries({ queryKey: qk.agents })
  if (run?.claim_id) void qc.invalidateQueries({ queryKey: qk.claim(run.claim_id) })
}

/** Exported for tests: fold one SSE message into the cache (pure part: lib/runEvents.ts `reduceRunMessage`). */
export function handleRunMessage(qc: QueryClient, runId: string, msg: SseMessage): RunMessageResult {
  const cached = qc.getQueryData<RunView>(qk.run(runId))
  const fx = reduceRunMessage(cached, msg)
  if (fx.run && fx.run !== cached) qc.setQueryData<RunView>(qk.run(runId), fx.run)
  if (fx.counts) qc.setQueryData(qk.strip(session.locationParam()), fx.counts)
  // Finished (cleanly or not): the server's Run.status is the truth, so ['run', id] is always refetched.
  if (fx.result !== 'continue') invalidateAfterRun(qc, runId, { refetchRun: true })
  else if (fx.refetchRun) void qc.invalidateQueries({ queryKey: qk.run(runId) })
  return fx.result
}

export function useRun(runId: string | undefined): { run: RunView | undefined; mode: StreamMode; error: unknown } {
  const qc = useQueryClient()
  const [mode, setMode] = useState<StreamMode>('idle')

  const query = useQuery({
    ...runQueryOptions(runId ?? 'none'),
    enabled: Boolean(runId),
    refetchInterval: (q) => ((mode === 'poll' || mode === 'desynced') && q.state.data && !isTerminal(q.state.data.status) ? 2000 : false),
  })

  const hasSnapshot = query.data !== undefined
  const terminal = query.data ? isTerminal(query.data.status) : false

  useEffect(() => {
    if (!runId || !hasSnapshot || terminal) return
    const ctrl = new AbortController()
    let attempt = 0
    void (async () => {
      while (!ctrl.signal.aborted) {
        const cached = qc.getQueryData<RunView>(qk.run(runId))
        if (cached && isTerminal(cached.status)) break
        let finished = 'continue' as RunMessageResult
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
              const r = handleRunMessage(qc, runId, msg)
              if (r !== 'continue') finished = r
            },
          })
        } catch {
          attempt++
          if (attempt >= 3) {
            setMode('poll')
            return
          }
        }
        if (finished === 'desynced') {
          if (!ctrl.signal.aborted) setMode('desynced')
          return
        }
        if (finished === 'done' || ctrl.signal.aborted) break
        await new Promise((r) => setTimeout(r, backoffMs(attempt)))
      }
      if (!ctrl.signal.aborted) setMode('idle')
    })()
    return () => {
      ctrl.abort()
    }
  }, [qc, runId, hasSnapshot, terminal])

  // Polling (fallback or after a desync) has no `done` event: do the same invalidation once the server's status is terminal.
  useEffect(() => {
    if ((mode === 'poll' || mode === 'desynced') && terminal && runId) invalidateAfterRun(qc, runId, { refetchRun: false })
  }, [mode, terminal, qc, runId])

  return { run: query.data, mode, error: query.error }
}
