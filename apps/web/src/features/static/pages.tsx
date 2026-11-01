/**
 * The static screens: real API reads of seed data, no mutations (docs/spec/00-product.md "Static").
 * Each is a typed shell — filters in the URL, data from the query cache — that the S2 workers deepen.
 */
import type { ReactNode } from 'react'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import type { z } from 'zod'
import { AgentKind, type LedgerRow } from '@/api/schema'
import { useActivity, useCash, useDenials, useEligibility, useLedger, useProposals, useRuleChanges, useRules } from '@/hooks/useStatic'
import { useAgentsKillSwitch, useAgentsStatus } from '@/hooks/useAgents'
import { count, dateTime, money, shortDate, time } from '@/lib/format'
import { AGENT_NAME, PAYER_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { EmptyState } from '@/components/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { Chip } from '@/components/Chip'
import { TierBadge } from '@/components/TierBadge'
import { Button } from '@/components/ui/Button'
import { SETTINGS_TABS } from './search'
import { SimpleTable, StaticNote } from './SimpleTable'

function Load<T>({ q, what, children }: { q: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; what: string; children: (d: T) => ReactNode }) {
  if (q.isPending) return <SkeletonRows rows={10} />
  if (q.isError || q.data === undefined) return <QueryError error={q.error} what={what} onRetry={() => void q.refetch()} />
  return <>{children(q.data)}</>
}

const Scroll = ({ children }: { children: ReactNode }) => <div className="min-h-0 flex-1 overflow-auto">{children}</div>

// ── Today's claims ────────────────────────────────────────────────────────────
type LedgerRowT = z.infer<typeof LedgerRow>
function LedgerSection<R extends LedgerRowT>({ title, rows, extra }: { title: string; rows: R[]; extra: (r: R) => string }) {
  return (
    <section aria-label={title}>
      <h2 className="m-0 mb-1 text-sm font-bold">
        {title} · {count(rows.length)}
      </h2>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-soft">None.</p>
      ) : (
        <SimpleTable
          label={title}
          rows={rows}
          rowKey={(r) => r.claim_id}
          cols={[
            { header: 'Claim', cell: (r) => <Link to="/claims/$claimId" params={{ claimId: r.claim_id }}>#{r.number}</Link> },
            { header: 'Patient', cell: (r) => r.patient_name },
            { header: 'Payer', cell: (r) => PAYER_NAME[r.payer_key] },
            { header: 'Billed', cell: (r) => money(r.billed_cents), className: 'text-right' },
            { header: 'What', cell: (r) => <span className="text-mid">{r.label}</span> },
            { header: 'File / hold', cell: (r) => <span className="text-mid">{extra(r)}</span> },
          ]}
        />
      )}
    </section>
  )
}

export function LedgerPage() {
  const q = useLedger()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Today’s claims" sub="built at checkout · what left, what leaves next, what is held" />
      <StaticNote>Read-only in this demo. Claims are built at checkout and leave in per-payer files; after a file leaves, the only reversal is a void.</StaticNote>
      <Scroll>
        <Load q={q} what="today’s claims">
          {(d) => (
            <div className="flex flex-col gap-4 p-4">
              <LedgerSection title="Leaving in the next file" rows={d.leaving_next_file} extra={(r) => `${r.file_time} file · editable until ${r.editable_until ?? '—'}`} />
              <LedgerSection title="Held" rows={d.held} extra={(r) => `${r.reason} · since ${time(r.held_since)} · ${r.owner}`} />
              <LedgerSection title="Sent" rows={d.sent} extra={() => 'sent'} />
              <LedgerSection title="Not billable" rows={d.not_billable} extra={() => '—'} />
            </div>
          )}
        </Load>
      </Scroll>
    </div>
  )
}

// ── Activity ──────────────────────────────────────────────────────────────────
const activityRoute = getRouteApi('/activity')
export function ActivityPage() {
  const search = activityRoute.useSearch()
  const navigate = useNavigate({ from: '/activity' })
  const q = useActivity(search)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Activity" sub="what agents did this week, and what you did">
        <select aria-label="Agent" value={search.agent ?? ''} onChange={(e) => void navigate({ search: (s) => ({ ...s, agent: AgentKind.safeParse(e.target.value).data }) })} className="rounded-md border border-line px-2 py-0.5 text-sm">
          <option value="">Agent: All</option>
          {AgentKind.options.map((a) => (
            <option key={a} value={a}>
              {AGENT_NAME[a]}
            </option>
          ))}
        </select>
      </PageHeader>
      <Scroll>
        <Load q={q} what="activity">
          {(d) =>
            d.items.length === 0 ? (
              <EmptyState title="Nothing ran without you yet" />
            ) : (
              <SimpleTable
                label="Activity"
                rows={d.items}
                rowKey={(r) => r.id}
                rowClassName={(r) => r.status === 'would_have_run' && 'italic text-mid'}
                cols={[
                  { header: 'Time', cell: (r) => dateTime(r.at) },
                  { header: 'Agent', cell: (r) => <span className="font-semibold text-acc">✦ {AGENT_NAME[r.agent]}</span> },
                  { header: 'Action', cell: (r) => r.action },
                  { header: 'Claim / patient', cell: (r) => (r.claim_id ? <Link to="/claims/$claimId" params={{ claimId: r.claim_id }}>{r.subject}</Link> : r.subject) },
                  { header: 'Outcome', cell: (r) => (r.status === 'would_have_run' ? <Chip tone="dashed">would have run</Chip> : <span className="text-mid">{r.outcome}</span>) },
                  { header: 'Ev.', cell: (r) => (r.evidence_count ? count(r.evidence_count) : '—'), className: 'text-right' },
                ]}
              />
            )
          }
        </Load>
      </Scroll>
    </div>
  )
}

// ── Eligibility ───────────────────────────────────────────────────────────────
const eligibilityRoute = getRouteApi('/eligibility')
export function EligibilityPage() {
  const search = eligibilityRoute.useSearch()
  const q = useEligibility({ date: search.date })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Eligibility" sub="verified by agents · re-checked the morning of the visit" />
      <Scroll>
        <Load q={q} what="eligibility">
          {(d) => (
            <SimpleTable
              label="Appointments"
              rows={d.items}
              rowKey={(r) => r.appointment_id}
              rowClassName={(r) => r.appointment_id === search.appt && 'bg-acc-bg'}
              cols={[
                { header: 'Time', cell: (r) => `${shortDate(r.start)} · ${time(r.start)}` },
                { header: 'Patient', cell: (r) => <b>{r.patient_name}</b> },
                { header: 'Provider', cell: (r) => r.provider_name },
                { header: 'Payer', cell: (r) => PAYER_NAME[r.payer_key] },
                { header: 'Planned', cell: (r) => <span className="text-mid">{r.planned_label}</span> },
                { header: 'Max left', cell: (r) => money(r.max_left_cents ?? null), className: 'text-right' },
                { header: 'Status', cell: (r) => <Chip tone={r.eligibility_status === 'verified' ? 'ok' : r.eligibility_status === 'issue' ? 'warn' : 'neutral'}>{r.eligibility_status}</Chip> },
                { header: 'Basis', cell: (r) => <span className="text-xs text-mid">{r.basis ?? '—'}</span> },
              ]}
            />
          )}
        </Load>
      </Scroll>
    </div>
  )
}

// ── Cash (owner) ──────────────────────────────────────────────────────────────
export function CashPage() {
  const q = useCash()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Cash" sub="owner view · every KPI shows its formula" />
      <Scroll>
        <Load q={q} what="cash">
          {(d) => (
            <div className="flex flex-col gap-4 p-4">
              <div className="grid grid-cols-4 gap-3">
                {Object.entries(d.kpis).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line px-3 py-2">
                    <div className="text-xs text-mid">{k.replace(/_/g, ' ')}</div>
                    <div className="text-[22px] font-extrabold">{v.value}</div>
                    {v.formula && <div className="text-xs text-mid">{v.formula}</div>}
                    {v.basis && <div className="text-2xs text-soft">{v.basis}</div>}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SimpleTable label="A/R aging" rows={d.aging} rowKey={(r) => r.bucket} cols={[{ header: 'Age', cell: (r) => r.bucket }, { header: 'Insurance A/R', cell: (r) => money(r.cents), className: 'text-right' }]} />
                <SimpleTable label="A/R by payer" rows={d.by_payer} rowKey={(r) => r.payer_key} cols={[{ header: 'Payer', cell: (r) => PAYER_NAME[r.payer_key] }, { header: 'A/R', cell: (r) => money(r.cents), className: 'text-right' }]} />
              </div>
            </div>
          )}
        </Load>
      </Scroll>
    </div>
  )
}

// ── Denials ───────────────────────────────────────────────────────────────────
const NEXT_ACTION = { reconsideration: 'Reconsideration', corrected: 'Corrected claim', formal_appeal: 'Formal appeal · dentist signs', bill_patient_link: 'Bill patient (closes in Payments)', write_off: 'Write-off · Dr. Morgan' } as const
export function DenialsPage() {
  const q = useDenials()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Denials" sub="worklist by next action · reconsideration ≠ formal appeal" />
      <Scroll>
        <Load q={q} what="denials">
          {(d) => (
            <div className="flex flex-col gap-4 p-4">
              {d.groups.map((g) => (
                <section key={g.next_action} aria-label={NEXT_ACTION[g.next_action]}>
                  <h2 className="m-0 mb-1 text-sm font-bold">
                    {NEXT_ACTION[g.next_action]} · {count(g.items.length)}
                  </h2>
                  <SimpleTable
                    label={NEXT_ACTION[g.next_action]}
                    rows={g.items}
                    rowKey={(r) => r.id}
                    cols={[
                      { header: 'Claim', cell: (r) => <Link to="/claims/$claimId" params={{ claimId: r.id }}>#{r.number}</Link> },
                      { header: 'Patient', cell: (r) => r.patient_name },
                      { header: 'Payer', cell: (r) => PAYER_NAME[r.payer_key] },
                      { header: 'Billed', cell: (r) => money(r.billed_cents), className: 'text-right' },
                      { header: 'Next step', cell: (r) => <span className="text-mid">{r.next_step ?? '—'}</span> },
                      {
                        header: '',
                        cell: (r) =>
                          g.next_action === 'formal_appeal' ? (
                            <Link to="/denials/$claimId" params={{ claimId: r.id }}>
                              Appeal workbench →
                            </Link>
                          ) : null,
                      },
                    ]}
                  />
                </section>
              ))}
            </div>
          )}
        </Load>
      </Scroll>
    </div>
  )
}

// ── Settings › Agents (shell; the interactive table is the S2 settings worker's) ─
const settingsRoute = getRouteApi('/settings/agents')
const TAB_LABEL = { rules: 'Rules', proposals: 'Proposals', changes: 'Changes' } as const
export function SettingsAgentsPage() {
  const search = settingsRoute.useSearch()
  const tab = search.tab ?? 'rules'
  const rules = useRules()
  const proposals = useProposals()
  const changes = useRuleChanges()
  const agents = useAgentsStatus()
  const kill = useAgentsKillSwitch()
  const paused = agents.data?.paused
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings › Agents" sub="what agents do alone, under a rule the owner signed, or never">
        {paused !== undefined && (
          <Button variant={paused ? 'primary' : 'danger'} size="sm" disabled={kill.isPending} onClick={() => kill.mutate(!paused)} title="Kill switch: queued runs park, running runs stop at the next step">
            {paused ? 'Resume agents' : 'Pause all agents'}
          </Button>
        )}
      </PageHeader>
      <div role="tablist" className="flex flex-none gap-1 border-b border-line px-3.5 py-2 text-sm">
        {SETTINGS_TABS.map((t) => (
          <Link key={t} role="tab" aria-selected={tab === t} to="/settings/agents" search={{ tab: t }} className={cn('rounded-xl px-2.5 py-0.5 no-underline', tab === t ? 'bg-ink font-semibold text-white' : 'text-mid')}>
            {TAB_LABEL[t]}
            {t === 'rules' && rules.data ? ` ${count(rules.data.total)}` : ''}
            {t === 'proposals' && proposals.data ? ` ${count(proposals.data.total)}` : ''}
            {t === 'changes' && changes.data ? ` ${count(changes.data.total)}` : ''}
          </Link>
        ))}
      </div>
      <Scroll>
        {tab === 'rules' && (
          <Load q={rules} what="rules">
            {(d) => (
              <SimpleTable
                label="Rules"
                rows={d.items}
                rowKey={(r) => r.id}
                cols={[
                  { header: 'Tier', cell: (r) => <TierBadge tier={r.tier} compact /> },
                  { header: 'Rule', cell: (r) => <b>{r.label ?? r.action}</b> },
                  { header: 'Mode', cell: (r) => <TierBadge tier={r.tier} mode={r.mode} compact /> },
                  { header: 'Ran w/o review · 7 d', cell: (r) => count(r.ran_without_review_7d), className: 'text-right' },
                  { header: 'Base rate', cell: (r) => (r.base_rate.n ? `${r.base_rate.k} of ${r.base_rate.n}` : '—'), className: 'text-right' },
                  { header: 'Signed', cell: (r) => (r.signed_by ? `${r.signed_by} · ${shortDate(r.signed_at ?? null)}` : r.requires_owner_signoff ? 'needs Dr. Morgan' : '—') },
                ]}
              />
            )}
          </Load>
        )}
        {tab === 'proposals' && (
          <Load q={proposals} what="proposals">
            {(d) => (
              <SimpleTable
                label="Proposals"
                rows={d.items}
                rowKey={(r) => r.id}
                cols={[
                  { header: 'Proposal', cell: (r) => <b>{r.title ?? r.id}</b> },
                  { header: 'Evidence', cell: (r) => `${r.evidence.approved}/${r.evidence.total} approved · ${r.evidence.outcome_k}/${r.evidence.outcome_n} paid` },
                  { header: 'Guard', cell: (r) => (r.root_cause_guard ? <span className="text-sm text-bad">{r.guard_reason ?? 'root cause: ours — cannot be accepted'}</span> : <span className="text-mid">—</span>) },
                  { header: 'State', cell: (r) => r.state },
                ]}
              />
            )}
          </Load>
        )}
        {tab === 'changes' && (
          <Load q={changes} what="rule changes">
            {(d) => (
              <SimpleTable
                label="Changes"
                rows={d.items}
                rowKey={(r) => r.id}
                cols={[
                  { header: 'When', cell: (r) => dateTime(r.at) },
                  { header: 'Rule', cell: (r) => r.rule_id },
                  { header: 'By', cell: (r) => r.by },
                  { header: 'Before → after', cell: (r) => <span className="font-mono text-xs">{JSON.stringify(r.before)} → {JSON.stringify(r.after)}</span> },
                  { header: 'Items since', cell: (r) => count(r.items_affected_since), className: 'text-right' },
                ]}
              />
            )}
          </Load>
        )}
      </Scroll>
    </div>
  )
}
