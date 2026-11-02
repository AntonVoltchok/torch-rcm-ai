import { useAgentsStatus } from '@/hooks/useAgents'
import { AGENT_COUNT } from '@/lib/payers'
import { time } from '@/lib/format'
import { useFirehoseState } from '@/state/live'
import { userName } from '@/features/settings/selectors'

/** "✦ 5 agents · 1 running" from GET /agents/status, kept fresh by the firehose; degrades, never lies. */
export function AgentsIndicator() {
  const status = useAgentsStatus()
  const firehose = useFirehoseState()
  if (status.isError) return <span className="text-soft">✦ agent status unavailable</span>
  const s = status.data
  return (
    <div className="flex flex-col gap-1" data-testid="agents-indicator">
      <span className="font-semibold text-acc">
        ✦ {s?.agents ?? AGENT_COUNT} agents · {s ? `${s.running} running` : '…'}
        {s && s.queued > 0 ? ` · ${s.queued} queued` : ''}
      </span>
      {s?.paused && (
        <span className="rounded border border-warn-line bg-warn-bg px-1.5 py-0.5 font-semibold text-warn">
          Agents paused{s.paused_by ? ` by ${userName(s.paused_by)}` : ''}
          {s.paused_at ? ` ${time(s.paused_at)}` : ''}
        </span>
      )}
      {s?.mode === 'live' && <span className="text-soft">live model: {s.live_agents.join(', ') || '—'}</span>}
      {firehose === 'down' && <span className="text-soft">live updates off · polling</span>}
    </div>
  )
}
