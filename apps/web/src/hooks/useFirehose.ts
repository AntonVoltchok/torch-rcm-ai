/**
 * GET /runs/stream, subscribed once at the app root. It never holds state of its own: `run` events
 * invalidate the agents status (and the run, if cached), `agents` patches the paused chip, `advance`
 * writes the clock-advance snapshot. When the stream is absent the app keeps working and the queries
 * that depend on it poll instead (liveStore = 'down').
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE } from '@/env'
import { authHeaders } from '@/api/client'
import { sseUrl } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { AdvanceSnapshot, FirehoseAgentsEvent, FirehoseRunEvent, type AgentsStatus, type Clock } from '@/api/schema'
import { backoffMs, connectSse, type SseMessage } from '@/lib/sse'
import { isTerminal } from '@/lib/runEvents'
import { liveStore } from '@/state/live'
import { useSession } from '@/state/session'

function parseData(msg: SseMessage): unknown {
  try {
    return JSON.parse(msg.data) as unknown
  } catch {
    return null
  }
}

export function useFirehose(): void {
  const qc = useQueryClient()
  const { userId } = useSession()

  useEffect(() => {
    const ctrl = new AbortController()
    let attempt = 0

    const onMessage = (msg: SseMessage) => {
      const data = parseData(msg)
      if (msg.event === 'run') {
        const ev = FirehoseRunEvent.safeParse(data)
        if (!ev.success) return
        void qc.invalidateQueries({ queryKey: qk.agents })
        if (isTerminal(ev.data.status) && ev.data.claim_id) void qc.invalidateQueries({ queryKey: qk.claim(ev.data.claim_id) })
      } else if (msg.event === 'agents') {
        const ev = FirehoseAgentsEvent.safeParse(data)
        if (!ev.success) return
        qc.setQueryData<AgentsStatus>(qk.agents, (old) => (old ? { ...old, paused: ev.data.paused, paused_by: ev.data.by, paused_at: ev.data.at } : old))
        void qc.invalidateQueries({ queryKey: qk.agents })
      } else if (msg.event === 'advance') {
        const ev = AdvanceSnapshot.safeParse(data)
        if (!ev.success) return
        const adv = ev.data
        qc.setQueryData(qk.advance(adv.advance_id), adv)
        // An advance another tab (or the CLI) started: tell the clock so the sidebar shows it and disables the control.
        // Completion (invalidate everything, once) is handled by useAdvanceCompletion, whichever channel says done.
        qc.setQueryData<Clock>(qk.clock, (old) =>
          old ? { ...old, now: adv.done ? old.now : adv.now, advancing: adv.done ? old.advancing : { advance_id: adv.advance_id, to: old.advancing?.to ?? adv.to ?? adv.now } } : old,
        )
      }
    }

    void (async () => {
      while (!ctrl.signal.aborted) {
        liveStore.set(attempt === 0 ? 'connecting' : liveStore.get())
        try {
          await connectSse({
            url: `${API_BASE}${sseUrl.firehose}`,
            headers: authHeaders(),
            signal: ctrl.signal,
            onOpen: () => {
              attempt = 0
              liveStore.set('live')
            },
            onMessage,
          })
        } catch {
          attempt++
          if (attempt >= 2) liveStore.set('down')
        }
        if (ctrl.signal.aborted) return
        await new Promise((r) => setTimeout(r, backoffMs(attempt)))
      }
    })()

    return () => {
      ctrl.abort()
    }
  }, [qc, userId])
}
