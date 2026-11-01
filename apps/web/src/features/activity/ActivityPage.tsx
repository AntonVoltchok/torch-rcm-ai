/**
 * Activity (mocks Round 2 · 5): the audit log of agent and human actions this week. Day / agent / outcome filters
 * and the Observe-mode preview toggle are search params; the header counts are the server's summary.
 */
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { ActivityOutcome, AgentKind, type ActivityRow } from '@/api/schema'
import { useActivity } from '@/hooks/useStatic'
import { useNow } from '@/hooks/useClock'
import { count, practiceDay, shortDate, time, weekday } from '@/lib/format'
import { AGENT_NAME } from '@/lib/payers'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { EmptyState } from '@/components/EmptyState'
import { Chip } from '@/components/Chip'
import { TierBadge } from '@/components/TierBadge'
import { EVIDENCE_LABEL, groupByDay, rowStyle, weekDays } from './selectors'

const route = getRouteApi('/activity')
const OUTCOME_LABEL: Record<ActivityOutcome, string> = { ran: 'Ran without you', awaiting: 'Awaiting you', would_have_run: 'Would have run' }

function Stat({ n, label, to }: { n: number; label: string; to?: '/inbox' }) {
  const body = (
    <>
      <b className="block text-[19px] font-extrabold leading-tight text-ink">{count(n)}</b>
      <span className="text-xs text-mid">{label}</span>
    </>
  )
  return to ? (
    <Link to={to} className="rounded-md border border-acc-line bg-acc-bg px-3 py-1.5 no-underline hover:border-acc">
      {body}
    </Link>
  ) : (
    <div className="rounded-md border border-line bg-white px-3 py-1.5">{body}</div>
  )
}

function Row({ r, observe }: { r: ActivityRow; observe: boolean }) {
  const style = rowStyle(r, observe)
  const shadow = style === 'would_have_run' || style === 'observe_preview'
  return (
    <tr data-run-id={r.run_id} data-style={style} className={cn('h-9 border-b border-light', shadow && 'italic text-mid')} title={r.audit_line || undefined}>
      <td className="whitespace-nowrap px-2 text-mid">{time(r.at)}</td>
      <td className="whitespace-nowrap px-2">{r.agent ? <span className="font-semibold text-acc">✦ {AGENT_NAME[r.agent]}</span> : <span className="rounded border border-line px-1 text-xs font-semibold">{r.actor ?? 'person'}</span>}</td>
      <td className="px-2">
        <span>{r.action}</span> {r.tier ? <TierBadge tier={r.tier} compact /> : null}
      </td>
      <td className="whitespace-nowrap px-2">{r.claim_id ? <Link to="/claims/$claimId" params={{ claimId: r.claim_id }}>{r.subject}</Link> : <span className="text-mid">{r.subject}</span>}</td>
      <td className="whitespace-nowrap px-2">
        {style === 'would_have_run' ? (
          <Chip tone="dashed">would have run</Chip>
        ) : style === 'observe_preview' ? (
          <Chip tone="dashed" title="Preview: in Observe mode this run would only have been logged">
            would have run · Observe
          </Chip>
        ) : style === 'awaiting' ? (
          <Link to="/inbox" className="no-underline">
            <Chip tone="acc">Awaiting you</Chip>
          </Link>
        ) : (
          <span className="text-mid">{r.outcome}</span>
        )}
      </td>
      <td className="px-2">
        <span className="flex flex-wrap gap-1">
          {r.evidence_kinds.map((k) => (
            <Chip key={k} tone="neutral" className="not-italic">
              {EVIDENCE_LABEL[k] ?? k}
            </Chip>
          ))}
        </span>
      </td>
    </tr>
  )
}

export function ActivityPage() {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/activity' })
  const now = useNow()
  const q = useActivity({ day: search.day, agent: search.agent, outcome: search.outcome })
  const observe = search.observe === true
  const select = 'rounded-md border border-line bg-white px-2 py-0.5 text-sm'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Activity" sub="what agents did this week, and what you did" />
      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-line px-[18px] py-2">
        <select aria-label="Day" value={search.day ?? ''} className={select} onChange={(e) => void navigate({ search: (s) => ({ ...s, day: e.target.value || undefined }) })}>
          <option value="">This week</option>
          {(now ? weekDays(now) : []).map((d) => (
            <option key={d} value={d}>
              {weekday(d)} {shortDate(d)}
            </option>
          ))}
        </select>
        <select aria-label="Agent" value={search.agent ?? ''} className={select} onChange={(e) => void navigate({ search: (s) => ({ ...s, agent: AgentKind.safeParse(e.target.value).data }) })}>
          <option value="">Agent: All</option>
          {AgentKind.options.map((a) => (
            <option key={a} value={a}>
              {AGENT_NAME[a]}
            </option>
          ))}
        </select>
        <select aria-label="Outcome" value={search.outcome ?? ''} className={select} onChange={(e) => void navigate({ search: (s) => ({ ...s, outcome: ActivityOutcome.safeParse(e.target.value).data }) })}>
          <option value="">Outcome: All</option>
          {ActivityOutcome.options.map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABEL[o]}
            </option>
          ))}
        </select>
        <label className="ml-2 inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={observe} onChange={(e) => void navigate({ search: (s) => ({ ...s, observe: e.target.checked || undefined }) })} />
          Observe mode preview
        </label>
        <span className="text-xs text-soft">{observe ? 'Showing what a new practice’s 14-day Observe default would have logged instead of run.' : ''}</span>
      </div>
      <Scroll>
        <Load q={q} what="activity">
          {(d) => (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap gap-2" data-testid="activity-summary">
                <Stat n={d.summary.status_checks} label="status checks" />
                <Stat n={d.summary.payer_calls} label="payer calls (with ref #)" />
                <Stat n={d.summary.claims_sent} label="claims sent" />
                <Stat n={d.summary.remittances_posted} label="remittances auto-posted" />
                <Stat n={d.summary.ran_without_you} label={`of ${count(d.summary.decisions)} decisions ran without you`} />
                <Stat n={d.summary.awaiting_you} label="awaiting you → Inbox" to="/inbox" />
              </div>
              {d.rows.length === 0 ? (
                <EmptyState title="Nothing matches these filters">Clear a filter to see the rest of the week.</EmptyState>
              ) : (
                <table aria-label="Activity" className="w-full border-collapse text-base">
                  <thead className="sticky top-0 bg-fill">
                    <tr>
                      {['Time', 'Agent', 'Action', 'Claim / patient', 'Outcome', 'Evidence'].map((h) => (
                        <th key={h} className="h-8 border-b border-line px-2 text-left text-2xs font-extrabold uppercase tracking-[.05em] text-soft">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {groupByDay(d.rows).map((g) => (
                    <tbody key={g.day} aria-label={`${weekday(g.day)} ${shortDate(g.day)}`}>
                      <tr className="bg-fill">
                        <th colSpan={6} scope="rowgroup" className="border-b border-line px-2 py-1 text-left text-xs font-bold">
                          {now && g.day === practiceDay(now) ? 'Today · ' : ''}
                          {weekday(g.day)} {shortDate(g.day)} <span className="font-normal text-mid">· {count(g.rows.length)} shown</span>
                        </th>
                      </tr>
                      {g.rows.map((r) => (
                        <Row key={r.run_id} r={r} observe={observe} />
                      ))}
                    </tbody>
                  ))}
                </table>
              )}
            </div>
          )}
        </Load>
      </Scroll>
    </div>
  )
}
