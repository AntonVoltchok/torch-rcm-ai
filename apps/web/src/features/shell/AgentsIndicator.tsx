import { Link } from '@tanstack/react-router'
import { useAgentsStatus } from '@/hooks/useAgents'
import { useStrip } from '@/hooks/useStrip'
import { AGENT_COUNT } from '@/lib/payers'
import { count, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useFirehoseState } from '@/state/live'
import { userName } from '@/features/settings/selectors'

/**
 * "5 agents · 1 running" from GET /agents/status, kept fresh by the firehose; degrades, never lies. Under it, D1's
 * week line from the strip: `nav_badges.activity` ran without anyone, `inbox_open` came to you.
 */
export function AgentsIndicator() {
  const status = useAgentsStatus()
  const strip = useStrip()
  const firehose = useFirehoseState()
  if (status.isError) return <span className="text-soft">Agent status unavailable</span>
  const s = status.data
  const live = (s?.running ?? 0) > 0
  return (
    <div className="flex flex-col gap-1.5" data-testid="agents-indicator">
      <span className={cn('inline-flex items-center gap-2 font-medium', live ? 'text-agents-ink' : 'text-ink')}>
        <i aria-hidden className={cn('h-2 w-2 flex-none rounded-[2px]', live ? 'animate-torch-agents-pulse bg-agents' : 'bg-nobody')} />
        {s?.agents ?? AGENT_COUNT} agents · {s ? `${s.running} running` : '…'}
        {s && s.queued > 0 ? ` · ${s.queued} queued` : ''}
      </span>
      {s?.paused && (
        <span className="rounded-md border border-warn-line bg-warn-bg px-2 py-1 text-xs font-medium text-warn">
          Agents paused{s.paused_by ? ` by ${userName(s.paused_by)}` : ''}
          {s.paused_at ? ` ${time(s.paused_at)}` : ''}
        </span>
      )}
      {strip.data && (
        <p className="m-0 text-sm leading-[1.45] text-mid">
          This week agents ran <strong className="text-ink">{count(strip.data.nav_badges.activity)}</strong> on their own.{' '}
          <strong className="text-ink">{count(strip.data.inbox_open)}</strong> came to you.{' '}
          <Link to="/activity" className="font-medium text-act no-underline hover:underline">
            See what they did
          </Link>
        </p>
      )}
      {s?.mode === 'live' && <span className="text-xs text-soft">Live model: {s.live_agents.join(', ') || '—'}</span>}
      {firehose === 'down' && <span className="text-xs text-soft">Live updates off, polling</span>}
    </div>
  )
}
