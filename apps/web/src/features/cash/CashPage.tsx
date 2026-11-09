/**
 * Cash (owner · mocks Round 3 D, revised Round 4): KPI tiles that carry their formula, A/R aging and by payer,
 * production by provider, write-offs by type, agent impact with its "estimate" basis. Every number is the
 * server's; the bars are drawn from the same rows the tables print.
 */
import type { ReactNode } from 'react'
import type { AgingBucket, Breakdown, Kpi } from '@/api/schema'
import { useCash } from '@/hooks/useStatic'
import { count, money, plural } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Load, Scroll } from '@/components/QueryBoundary'
import { SkeletonBlock } from '@/components/ui/Skeleton'

/** The tiles across the top; the rest are in the "Every KPI" table below. */
export const HEADLINE_KPIS = ['days_in_ar', 'insurance_ar', 'patient_ar', 'collections_month', 'net_collection_rate', 'non_contractual_month'] as const
const BUCKET: Record<string, string> = { '0_30': '0–30 days', '31_60': '31–60', '61_90': '61–90', '90_plus': '90+' }

export function kpiValue(k: Kpi): string {
  switch (k.unit) {
    case 'cents':
      return money(Math.round(k.value), { cents: 'never' })
    case 'pct':
      return `${k.value.toFixed(1)}%`
    case 'days':
      return `${Math.round(k.value)}`
    default:
      return count(k.value)
  }
}

function KpiTile({ k }: { k: Kpi }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line px-4 py-3" data-kpi={k.key}>
      <span className="flex min-h-10 items-start gap-1.5 text-sm text-mid">
        {k.label}
        <span tabIndex={0} role="img" aria-label={`Formula: ${k.formula}. ${k.basis}`} title={`= ${k.formula}\n${k.basis}`} className="cursor-help rounded-full border border-line-strong px-1.5 text-xs text-soft">
          ƒ
        </span>
      </span>
      <b className="text-kpi font-semibold nums-proportional">{kpiValue(k)}</b>
      <span className="truncate text-xs text-mid" title={k.formula}>
        = {k.formula}
      </span>
      <span className="truncate text-xs text-soft" title={k.basis}>
        {k.basis}
      </span>
    </div>
  )
}

/** One-hue horizontal bars with a per-bar tooltip; the label and value are text beside the bar, not on it. The
 * oldest aging bucket is the money at risk, so it alone takes the risk hue. */
function Bars({ label, rows, highlightLast = false }: { label: string; rows: { key: string; label: string; cents: number; note?: string }[]; highlightLast?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.cents))
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-1.5 p-0">
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[96px_1fr_88px] items-center gap-2 text-sm" title={`${r.label}: ${money(r.cents)}${r.note ? ` · ${r.note}` : ''}`}>
          <span className="truncate text-mid">{r.label}</span>
          <span className="h-3 rounded-r bg-light">
            <span className={`block h-3 rounded-r ${highlightLast && i === rows.length - 1 ? 'bg-risk' : 'bg-mid'}`} style={{ width: `${Math.max(1, (100 * r.cents) / max)}%` }} />
          </span>
          <span className="text-right font-medium tabular-nums">{money(r.cents)}</span>
        </li>
      ))}
    </ul>
  )
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h2 className="m-0 text-md font-semibold">
        {title} {sub && <span className="text-sm font-normal text-mid">{sub}</span>}
      </h2>
      {children}
    </section>
  )
}

const aging = (rows: AgingBucket[]) => rows.map((b) => ({ key: b.bucket, label: BUCKET[b.bucket] ?? b.bucket, cents: b.cents, note: `${count(b.count)} · ${b.pct}%` }))
const breakdown = (rows: Breakdown[]) => rows.map((b) => ({ key: b.key, label: b.label, cents: b.cents, note: `${count(b.count)}` }))

export function CashPage() {
  const q = useCash()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Cash" sub="owner view · every KPI shows its formula" />
      <Scroll>
        <Load q={q} what="cash" skeleton={<div className="grid grid-cols-6 gap-3 p-4">{Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} className="h-24" />)}</div>}>
          {(d) => {
            const byKey = new Map(d.kpis.map((k) => [k.key, k]))
            const tiles = HEADLINE_KPIS.flatMap((k) => byKey.get(k) ?? [])
            const insuranceAr = byKey.get('insurance_ar')
            const contractual = byKey.get('contractual_month')
            const over90 = d.aging.find((b) => b.bucket === '90_plus')
            const impact = d.agent_impact
            const ap = d.appeals_12mo
            return (
              <div className="flex flex-col gap-4 p-5">
                <div className="grid grid-cols-3 gap-3 xl:grid-cols-6" data-testid="cash-kpis">
                  {tiles.map((k) => (
                    <KpiTile key={k.key} k={k} />
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Card title={insuranceAr ? `Insurance A/R ${kpiValue(insuranceAr)}` : 'Insurance A/R'} sub={over90 ? `· ${over90.pct}% over 90 days` : undefined}>
                    <Bars label="A/R aging" rows={aging(d.aging)} highlightLast />
                    <table className="w-full text-sm">
                      <tbody>
                        {d.aging.map((b) => (
                          <tr key={b.bucket} className="border-t border-line">
                            <td className="py-0.5">{BUCKET[b.bucket] ?? b.bucket}</td>
                            <td className="text-right tabular-nums">{money(b.cents)}</td>
                            <td className="text-right text-mid">{plural(b.count, 'claim')}</td>
                            <td className="text-right text-mid">{b.pct}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                  <Card title="A/R by payer">
                    <Bars label="A/R by payer" rows={breakdown(d.by_payer)} />
                  </Card>
                  <Card title="Agent impact" sub="this week">
                    <p className="m-0 text-sm" data-testid="agent-impact">
                      <span className="font-semibold">{count(impact.items_auto)} ran without review</span> · {count(impact.items_to_you)} to staff
                    </p>
                    <div className="rounded-md border border-dashed border-line-strong px-3 py-2">
                      <div className="text-sm text-mid">
                        {impact.hours_saved_est.label} <span className="rounded bg-light px-1.5 text-xs font-medium text-ink">estimate</span>
                      </div>
                      <b className="text-title font-semibold">≈ {impact.hours_saved_est.value} h</b>
                      <div className="text-xs text-mid">= {impact.hours_saved_est.formula}</div>
                      <div className="text-xs text-soft" data-testid="hours-basis">
                        {impact.hours_saved_est.basis}
                      </div>
                    </div>
                    <p className="m-0 text-sm text-mid">
                      Appeals, 12 mo: <b className="text-ink">{count(ap.won)} of {count(ap.total)} won</b> · reconsiderations {count(ap.reconsideration_won)} of {count(ap.reconsideration_total)} · formal {count(ap.formal_won)} of {count(ap.formal_total)}
                    </p>
                  </Card>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Card title="A/R by provider" sub="billed, by rendering provider">
                    <Bars label="By provider" rows={breakdown(d.by_provider)} />
                  </Card>
                  <Card title="Write-offs by type" sub="non-contractual · this month">
                    <table aria-label="Write-offs by type" className="w-full text-sm">
                      <tbody>
                        {d.writeoffs_by_type.map((w) => (
                          <tr key={w.key} className="border-t border-line">
                            <td className="py-0.5 capitalize">{w.label}</td>
                            <td className="text-right tabular-nums">{money(w.cents)}</td>
                            <td className="text-right text-mid">{plural(w.count, 'line')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="m-0 text-sm text-mid">
                      Agents can propose a write-off, never post one (tier 3). Contractual write-offs post with balanced ERAs (tier 2){contractual ? `: ${kpiValue(contractual)} this month` : ''}.
                    </p>
                  </Card>
                  <Card title="Patient A/R" sub="aged from DOS">
                    <Bars label="Patient A/R aging" rows={aging(d.patient_aging)} />
                  </Card>
                </div>
                <Card title="Every KPI" sub="value · formula · basis">
                  <table aria-label="Every KPI" className="w-full text-sm">
                    <tbody>
                      {d.kpis.map((k) => (
                        <tr key={k.key} className="border-t border-line">
                          <td className="py-1.5 font-medium">{k.label}</td>
                          <td className="text-right font-semibold tabular-nums">{kpiValue(k)}</td>
                          <td className="pl-3 text-mid">= {k.formula}</td>
                          <td className="pl-3 text-soft">{k.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )
          }}
        </Load>
      </Scroll>
    </div>
  )
}
