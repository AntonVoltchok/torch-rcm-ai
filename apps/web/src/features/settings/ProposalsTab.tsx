/**
 * Proposals: rules learned from approvals and their outcomes (tier 1 only). Accept creates a learned rule;
 * Edit opens the base rule in the Rules tab with its live preview; Dismiss retires the proposal. The
 * `root_cause_guard` card can never be accepted — the button is disabled with the reason, and the server
 * refuses it again (422) if anything slips through.
 */
import { Link } from '@tanstack/react-router'
import type { RuleProposal } from '@/api/schema'
import { useAcceptProposal, useDismissProposal } from '@/hooks/useRules'
import { count, shortDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/EmptyState'
import { TierBadge } from '@/components/TierBadge'

export function blockedReason(p: RuleProposal): string | null {
  if (p.root_cause_guard) return 'Can’t be learned · root cause: ours. Fix the upstream rule instead.'
  if (p.watching) return `Watching · n = ${p.evidence.total}: needs 20 resolved items before it can be accepted.`
  return null
}

function ProposalCard({ p }: { p: RuleProposal }) {
  const accept = useAcceptProposal()
  const dismiss = useDismissProposal()
  const blocked = blockedReason(p)
  const ruleId = typeof p.rule_draft.rule_id === 'string' ? p.rule_draft.rule_id : undefined
  const busy = accept.isPending || dismiss.isPending
  return (
    <article
      aria-label={`Proposal ${p.title}`}
      data-proposal-id={p.id}
      className={cn('flex flex-col gap-2 rounded-lg border px-4 py-3', p.root_cause_guard ? 'border-risk-line bg-risk-bg' : p.watching ? 'border-dashed border-line-strong bg-paper' : 'border-agents-line bg-agents-bg')}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className={cn('text-sm font-semibold', p.root_cause_guard ? 'text-risk-ink' : p.watching ? 'text-mid' : 'text-agents-ink')}>
          {p.root_cause_guard ? 'Can’t be learned · root cause: ours' : p.watching ? 'Watching' : '✦ Proposed'}
        </span>
        <TierBadge tier={1} compact />
        <span className="ml-auto text-xs text-soft">since {shortDate(p.created_at)}</span>
      </header>
      <h3 className="m-0 text-base font-semibold">{p.title}</h3>
      <p className="m-0 text-sm" data-testid="proposal-evidence">
        <b>
          {count(p.evidence.approved)} of {count(p.evidence.total)} approved
        </b>
        {p.evidence.outcome_n > 0 ? (
          <>
            {' '}
            · <b>{count(p.evidence.outcome_k)} of {count(p.evidence.outcome_n)}</b> paid ≤ 30 d
          </>
        ) : (
          <span className="text-mid"> · no outcomes yet</span>
        )}
      </p>
      {p.note && <p className="m-0 text-sm text-mid">{p.note}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button variant="primary" size="sm" disabled={Boolean(blocked) || busy} title={blocked ?? 'Creates a learned tier-1 rule that runs without review, signed by you'} onClick={() => accept.mutate(p.id)}>
          Accept
        </Button>
        {ruleId ? (
          <Link to="/settings/agents" search={{ tab: 'rules', rule: ruleId }} className="inline-flex h-7 items-center rounded-md border border-line-strong bg-paper px-2.5 text-sm font-medium text-ink no-underline hover:bg-hover">
            Edit
          </Link>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => dismiss.mutate(p.id)}>
          Dismiss
        </Button>
        {blocked && (
          <span role="note" className={cn('text-sm font-medium', p.root_cause_guard ? 'text-risk-ink' : 'text-mid')} data-testid="proposal-blocked">
            {blocked}
          </span>
        )}
      </div>
    </article>
  )
}

export function ProposalsTab({ proposals }: { proposals: RuleProposal[] }) {
  const open = proposals.filter((p) => p.state === 'open')
  const resolved = proposals.filter((p) => p.state !== 'open')
  return (
    <div className="flex max-w-[860px] flex-col gap-3 p-4">
      <p className="m-0 text-sm text-mid">Learned rules are tier 1 only, need an outcome metric, and never include a slice whose root cause is ours.</p>
      {open.length === 0 ? <EmptyState title="No open proposals">They appear when your approvals and their outcomes make a case for a rule.</EmptyState> : open.map((p) => <ProposalCard key={p.id} p={p} />)}
      {resolved.length > 0 && (
        <section aria-label="Resolved proposals" className="text-sm text-mid">
          <h3 className="m-0 mb-1 text-sm font-semibold text-ink">Resolved</h3>
          <ul className="m-0 list-none p-0">
            {resolved.map((p) => (
              <li key={p.id}>
                {p.title} · <b>{p.state}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
