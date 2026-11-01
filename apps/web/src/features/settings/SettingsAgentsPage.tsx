/**
 * Settings › Agents (interactive): tabs rules | proposals | changes in the URL, the owner's pause/resume.
 * Billing sees and proposes (tier-2 changes go to Dr. Morgan as sign-off items); the owner signs.
 */
import { getRouteApi, Link } from '@tanstack/react-router'
import { useAgentsKillSwitch, useAgentsStatus } from '@/hooks/useAgents'
import { useProposals, useRuleChanges, useRules } from '@/hooks/useRules'
import { count, time } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { Button } from '@/components/ui/Button'
import { SETTINGS_TABS, type SettingsTab } from './search'
import { RulesTab } from './RulesTab'
import { ProposalsTab } from './ProposalsTab'
import { ChangesTab } from './ChangesTab'

const route = getRouteApi('/settings/agents')
const TAB_LABEL: Record<SettingsTab, string> = { rules: 'Rules', proposals: 'Proposals', changes: 'Changes' }

function AgentsSwitch() {
  const user = useCurrentUser()
  const agents = useAgentsStatus()
  const kill = useAgentsKillSwitch()
  const s = agents.data
  if (!s) return null
  if (user.role !== 'owner') {
    return s.paused ? <span className="rounded border border-warn-line bg-warn-bg px-1.5 text-xs font-semibold text-warn">Agents paused by {s.paused_by ?? 'the owner'}</span> : null
  }
  return (
    <span className="inline-flex items-center gap-2">
      {s.paused && (
        <span className="text-xs font-semibold text-warn">
          Paused {s.paused_at ? time(s.paused_at) : ''} · {count(s.paused_runs)} runs parked
        </span>
      )}
      <Button variant={s.paused ? 'primary' : 'danger'} size="sm" disabled={kill.isPending} onClick={() => kill.mutate(!s.paused)} title="Queued runs park, running runs stop at the next step; the payers and the clock keep going">
        {s.paused ? 'Resume agents' : 'Pause all agents'}
      </Button>
    </span>
  )
}

export function SettingsAgentsPage() {
  const search = route.useSearch()
  const tab = search.tab ?? 'rules'
  const rules = useRules()
  const proposals = useProposals()
  const changes = useRuleChanges()
  const counts: Record<SettingsTab, number | undefined> = {
    rules: rules.data?.tiers.reduce((a, t) => a + t.rows.length, 0),
    proposals: rules.data?.proposals_open ?? proposals.data?.items.filter((p) => p.state === 'open').length,
    changes: rules.data?.changes_count ?? changes.data?.total,
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings › Agents" sub="rules grouped by what the action touches">
        <AgentsSwitch />
      </PageHeader>
      <div role="tablist" aria-label="Settings sections" className="flex flex-none items-center gap-1 border-b border-line px-3.5 py-2 text-sm">
        {SETTINGS_TABS.map((t) => (
          <Link
            key={t}
            role="tab"
            aria-selected={tab === t}
            to="/settings/agents"
            search={(s) => ({ ...s, tab: t })}
            className={cn('rounded-xl px-2.5 py-0.5 no-underline', tab === t ? 'bg-ink font-semibold text-white' : 'text-mid hover:text-ink')}
          >
            {TAB_LABEL[t]}
            {counts[t] !== undefined ? ` ${count(counts[t])}` : ''}
          </Link>
        ))}
        <span className="ml-auto text-xs text-soft">Modes: Observe · Ask Dana · Runs without review · Human only</span>
      </div>
      <Scroll>
        {tab === 'rules' && (
          <Load q={rules} what="rules" rows={19}>
            {(d) => <RulesTab data={d} selected={search.rule} />}
          </Load>
        )}
        {tab === 'proposals' && (
          <Load q={proposals} what="proposals" rows={3}>
            {(d) => <ProposalsTab proposals={d.items} />}
          </Load>
        )}
        {tab === 'changes' && (
          <Load q={changes} what="rule changes" rows={5}>
            {(d) => <ChangesTab changes={d.items} rules={rules.data} />}
          </Load>
        )}
      </Scroll>
    </div>
  )
}
