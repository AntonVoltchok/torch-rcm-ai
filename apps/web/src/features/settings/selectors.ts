/**
 * Pure view logic for Settings › Agents. Every number is the server's (GET /rules, /settings/preview,
 * /rules/changes): tier totals, preview totals and the digest come computed; these functions only label and group.
 */
import type { OutcomeMetric, Preview, ReversesIn, Role, Rule, RuleChange, RuleDigest, RuleMode, RuleRow, RulesOut, Tier, TierGroup } from '@/api/schema'
import { PAYER_NAME } from '@/lib/payers'
import { money, shortDate } from '@/lib/format'
import { USERS } from '@/state/session'

/** Modes are named for people (mocks Round 4 · Settings). */
export const MODE_LABEL: Record<RuleMode, string> = { observe: 'Observe', ask: 'Ask Dana', auto: 'Runs without review', human_only: 'Human only' }
export const TIER_ORDER: readonly Tier[] = [1, 2, 3]

/** Tier 3 has no control at all: there is no code path that automates it. */
export function modeOptions(tier: Tier): RuleMode[] {
  return tier === 3 ? [] : ['observe', 'ask', 'auto']
}

const OUTCOME_LABEL: Record<OutcomeMetric, string> = { paid_30d: 'paid ≤ 30 d', accepted: 'accepted', balanced: 'balanced', none: 'not learnable' }
const OUTCOME_NOUN: Record<OutcomeMetric, string> = { paid_30d: 'paid', accepted: 'acc.', balanced: 'kept', none: '' }
const REVERSES_LABEL: Record<ReversesIn, string> = { until_file_leaves: 'until file leaves', until_day_close: 'until day close', void_only: 'void only', none: '—' }

export function userName(id: string | null | undefined): string {
  if (!id) return '—'
  return USERS.find((u) => u.id === id)?.name ?? (id === 'system' ? 'TorchRCM' : id)
}

/** "≥ 90% · 23/25 paid", or amber "no outcome data" when the rule has no outcome metric (owner-authored, never learned). */
export function floorLabel(rule: Rule): { text: string; tone: 'normal' | 'warn' | 'muted' } {
  if (rule.tier === 3) return { text: '—', tone: 'muted' }
  const metric = rule.outcome_metric ?? 'none'
  if (metric === 'none') return { text: 'no outcome data', tone: 'warn' }
  const floor = rule.confidence_floor ? `≥ ${Math.round(rule.confidence_floor * 100)}%` : null
  const { n, k } = rule.base_rate ?? { n: 0, k: 0 }
  const base = n > 0 ? `${k}/${n} ${OUTCOME_NOUN[metric]}` : 'no base rate yet'
  return { text: [floor, base].filter(Boolean).join(' · '), tone: n > 0 ? 'normal' : 'muted' }
}

const ITEM_TYPE: Record<string, string> = {
  all: '',
  'denied:CO-16:N29:pa_missing': 'CO-16 · N29 missing PA',
  crown_narrative: 'crowns',
  srp_chart_attached: 'SRP · chart attached',
}

/** "Delta · CO-16 · N29 missing PA · any $" / "All · ≤ $2,000". */
export function scopeLabel(rule: Rule): string {
  const { payer_key, item_type = 'all', max_cents } = rule.scope ?? {}
  const who = payer_key ? PAYER_NAME[payer_key] : 'All'
  const what = ITEM_TYPE[item_type] ?? item_type.replace(/[_:]/g, ' ')
  const cap = max_cents ? `≤ ${money(max_cents)}` : 'any $'
  return [who, what, cap].filter(Boolean).join(' · ')
}

export const outcomeLabel = (m: OutcomeMetric) => OUTCOME_LABEL[m]
export const reversesLabel = (r: ReversesIn) => REVERSES_LABEL[r]

/** The "Owner sign-off" column: tier 3 is locked; tier 2 needs Dr. Morgan's signature; learned tier-1 rules name who accepted them. */
export function signoffLabel(row: RuleRow): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  const r = row.rule
  if (r.tier === 3) return { text: 'locked · no toggle', tone: 'muted' }
  if (r.tier === 2) {
    return r.signed_by ? { text: `✓ signed ${shortDate(r.signed_at)} ${row.signed_by_name ?? userName(r.signed_by)}`, tone: 'ok' } : { text: 'needs Dr. Morgan', tone: 'warn' }
  }
  if (r.origin === 'learned' && r.signed_by) return { text: `signed by ${row.signed_by_name ?? userName(r.signed_by)}`, tone: 'ok' }
  return { text: 'not needed · tier 1', tone: 'muted' }
}

export const changedLabel = (r: Rule) => `${shortDate(r.changed_at)} ${userName(r.changed_by)}`

export interface RuleRowView {
  id: string
  tier: Tier
  label: string
  agent: Rule['agent']
  scope: string
  mode: RuleMode
  modeLabel: string
  /** 'control' = segmented Observe / Ask Dana / Runs without review; 'human_only' = text, no control. */
  control: 'control' | 'human_only'
  options: RuleMode[]
  /** Tier 2 and the viewer is not the owner: a change goes to Dr. Morgan as a sign-off request. */
  needsOwner: boolean
  floor: ReturnType<typeof floorLabel>
  outcome: string
  reverses: string
  ran: number
  routine: number
  waiting: number
  changed: string
  signoff: ReturnType<typeof signoffLabel>
  learned: boolean
}

export function rowView(row: RuleRow, viewer: Role): RuleRowView {
  const r = row.rule
  const humanOnly = r.tier === 3 || row.locked || r.mode === 'human_only'
  return {
    id: r.id,
    tier: r.tier,
    label: r.label,
    agent: r.agent,
    scope: scopeLabel(r),
    mode: r.mode,
    modeLabel: MODE_LABEL[humanOnly ? 'human_only' : r.mode],
    control: humanOnly ? 'human_only' : 'control',
    options: humanOnly ? [] : modeOptions(r.tier),
    needsOwner: r.tier === 2 && viewer !== 'owner',
    floor: floorLabel(r),
    outcome: r.tier === 3 ? '—' : outcomeLabel(r.outcome_metric ?? 'none'),
    reverses: reversesLabel(r.reverses_in ?? 'none'),
    ran: row.ran_without_review_7d,
    routine: row.routine_runs_7d,
    waiting: row.waiting,
    changed: changedLabel(r),
    signoff: signoffLabel(row),
    learned: r.origin === 'learned',
  }
}

export interface TierView {
  tier: Tier
  label: string
  description: string
  rows: RuleRowView[]
  /** "9 rules · ran 29 · 5 waiting": the server's tier totals (`TierGroup.count`, `ran_without_review_7d`, `waiting`). */
  summary: string
}

/** The table's tbody groups, always in tier order 1 → 2 → 3, whatever order the server sent. */
export function tierViews(data: RulesOut, viewer: Role): TierView[] {
  return TIER_ORDER.flatMap((tier) => {
    const g: TierGroup | undefined = data.tiers.find((t) => t.tier === tier)
    if (!g) return []
    const rows = g.rows.map((r) => rowView(r, viewer))
    const n = `${g.count} rule${g.count === 1 ? '' : 's'}`
    return [
      {
        tier,
        label: g.label,
        description: g.description,
        rows,
        summary: tier === 3 ? `${n} · human only · no toggle` : `${n} · ran ${g.ran_without_review_7d} · ${g.waiting} waiting`,
      },
    ]
  })
}

export function findRow(data: RulesOut | undefined, ruleId: string | undefined): RuleRow | undefined {
  if (!data || !ruleId) return undefined
  for (const t of data.tiers) for (const r of t.rows) if (r.rule.id === ruleId) return r
  return undefined
}

/** Optimistic PATCH: the same table with one rule's mode flipped (nothing else is guessed). */
export function withRuleMode(data: RulesOut, ruleId: string, mode: RuleMode): RulesOut {
  return { ...data, tiers: data.tiers.map((t) => ({ ...t, rows: t.rows.map((r) => (r.rule.id === ruleId ? { ...r, rule: { ...r.rule, mode } } : r)) })) }
}

/** The server's answer replaces the row's rule; counts stay until the refetch brings the server's. */
export function withRule(data: RulesOut, rule: Rule): RulesOut {
  return { ...data, tiers: data.tiers.map((t) => ({ ...t, rows: t.rows.map((r) => (r.rule.id === rule.id ? { ...r, rule } : r)) })) }
}

const HELD_LABEL: Record<string, string> = { ours: 'root cause: ours', over_cap: 'over the cap' }

export interface PreviewView {
  from: number
  /** Would have run by scope, before holds (`before_holds`). */
  to: number
  net: number
  total: number
  held: { reason: string; label: string; count: number }[]
  headline: string
  holdLine: string | null
  /** With nothing held: what the change does to this week, from `net_change`. */
  changeLine: string
}

/** "41 → 44 of this week's 54 would have run" + "but 3 of the 44 are root cause: ours → held for Dana · net 41". */
export function previewView(p: Preview): PreviewView {
  const held = Object.entries(p.held_by_root_cause)
    .filter(([, n]) => n > 0)
    .map(([reason, count]) => ({ reason, label: HELD_LABEL[reason] ?? reason.replace(/_/g, ' '), count }))
  const to = p.before_holds
  const d = p.net_change
  return {
    from: p.baseline_would_run,
    to,
    net: p.would_run,
    total: p.total,
    held,
    headline: `${p.baseline_would_run} → ${to} of this week’s ${p.total} would have run`,
    holdLine: p.held_total
      ? `but ${held.map((h, i) => (i === 0 ? `${h.count} of the ${to} are ${h.label}` : `${h.count} ${h.label}`)).join(', ')} → held for Dana · net ${p.would_run}`
      : null,
    changeLine: d === 0 ? 'No change this week.' : d > 0 ? `${d} more would have run without review.` : `${-d} fewer would have run without review.`,
  }
}

/** "mode: ask → auto" lines for the Changes log; keys that did not change are left out. */
export function changeDiff(c: RuleChange): string[] {
  const keys = [...new Set([...Object.keys(c.before), ...Object.keys(c.after)])]
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—'
    if (typeof v === 'string') return MODE_LABEL[v as RuleMode] ?? (USERS.some((u) => u.id === v) ? userName(v) : v)
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    return JSON.stringify(v)
  }
  return keys.filter((k) => JSON.stringify(c.before[k]) !== JSON.stringify(c.after[k])).map((k) => `${k.replace(/_/g, ' ')}: ${show(c.before[k])} → ${show(c.after[k])}`)
}

/** The owner's Monday digest line, from the server's `RuleChangeList.digest` (this Mon-start week so far). */
export function digestText(d: RuleDigest): string {
  return `Mon digest to Dr. Morgan (week of ${shortDate(d.period_start)}, so far): ${d.changes} change${d.changes === 1 ? '' : 's'} · ${d.items_run} ran under them · ${d.awaiting_signoff} await${d.awaiting_signoff === 1 ? 's' : ''} sign-off`
}
