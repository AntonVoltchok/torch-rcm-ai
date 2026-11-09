import type { AgentKind } from '@/api/schema'
import { AGENT_NAME } from '@/lib/payers'

/** ✦ marks agent work everywhere (the mocks' convention). */
export function AgentChip({ agent, label }: { agent?: AgentKind | null | undefined; label: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 truncate text-xs font-medium text-agents-ink" title={agent ? `${AGENT_NAME[agent]} agent` : undefined}>
      <span aria-hidden>✦</span>
      <span className="truncate">{label}</span>
    </span>
  )
}
