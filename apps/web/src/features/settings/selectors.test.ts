import { describe, expect, it } from 'vitest'
import { RulesOut } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { changeDiff, floorLabel, previewView, rowView, tierViews, weeklyDigest, withRuleMode } from './selectors'

const rules = (): RulesOut => RulesOut.parse(new MockDb({ stepDelayMs: 0, schedule: () => undefined }).rules())
const row = (data: RulesOut, id: string) => {
  for (const t of data.tiers) for (const r of t.rows) if (r.rule.id === id) return r
  throw new Error(`no ${id}`)
}

describe('rules table selectors', () => {
  it('groups rows by tier in order 1 → 2 → 3 with the mocks’ tier names, whatever order the server sent', () => {
    const data = rules()
    const shuffled = { ...data, tiers: [...data.tiers].reverse() }
    const views = tierViews(shuffled, 'owner')
    expect(views.map((t) => t.tier)).toEqual([1, 2, 3])
    expect(views.map((t) => t.label)).toEqual(['Talks to payers', 'Touches the ledger or patients', 'Commits the practice'])
    expect(views.map((t) => t.rows.length)).toEqual([9, 7, 3])
  })

  it('sums the server’s per-row counts into the tier header (29 ran in tier 1, 12 in tier 2)', () => {
    const views = tierViews(rules(), 'billing')
    expect(views[0]?.summary).toBe('9 rules · ran 29 · 5 waiting')
    expect(views[1]?.summary).toBe('7 rules · ran 12 · 2 waiting')
    expect(views[2]?.summary).toBe('3 rules · human only · no toggle')
  })

  it('renders tier 3 as “Human only” with no control, for every viewer', () => {
    for (const viewer of ['owner', 'billing'] as const) {
      for (const r of tierViews(rules(), viewer)[2]?.rows ?? []) {
        expect(r.control).toBe('human_only')
        expect(r.options).toEqual([])
        expect(r.modeLabel).toBe('Human only')
        expect(r.signoff.text).toBe('locked · no toggle')
      }
    }
  })

  it('gives tiers 1–2 the three people-named modes, and marks tier 2 “needs Dr. Morgan” for anyone but the owner', () => {
    const data = rules()
    const era = row(data, 'rule_t2_post_era')
    expect(rowView(era, 'billing')).toMatchObject({ control: 'control', options: ['observe', 'ask', 'auto'], needsOwner: true, modeLabel: 'Runs without review' })
    expect(rowView(era, 'owner').needsOwner).toBe(false)
    expect(rowView(row(data, 'rule_t1_status_check'), 'billing').needsOwner).toBe(false)
  })

  it('shows the floor with its base rate, or amber “no outcome data” when nothing measures the outcome', () => {
    const data = rules()
    expect(floorLabel(row(data, 'rule_t1_records_request').rule)).toEqual({ text: '≥ 90% · 91/97 paid', tone: 'normal' })
    expect(floorLabel(row(data, 'rule_t1_delta_pa').rule)).toEqual({ text: '23/25 paid', tone: 'normal' })
    expect(floorLabel(row(data, 'rule_t1_status_check').rule)).toEqual({ text: 'no outcome data', tone: 'warn' })
  })

  it('flips exactly one rule optimistically and nothing else', () => {
    const data = rules()
    const next = withRuleMode(data, 'rule_t1_status_check', 'auto')
    expect(row(next, 'rule_t1_status_check').rule.mode).toBe('auto')
    expect(row(next, 'rule_t1_status_check').ran_without_review_7d).toBe(row(data, 'rule_t1_status_check').ran_without_review_7d)
    expect(row(next, 'rule_t1_delta_pa').rule.mode).toBe('ask')
    expect(row(data, 'rule_t1_status_check').rule.mode).toBe('ask')
  })
})

describe('preview and changes selectors', () => {
  it('reads “41 → 44 of this week’s 54” with the ours guard holding 3 (net 41)', () => {
    const v = previewView({ rule_id: 'rule_t1_delta_pa', mode: 'auto', max_cents: null, would_run: 41, total: 54, baseline_would_run: 41, held_by_root_cause: { ours: 3 } })
    expect(v.headline).toBe('41 → 44 of this week’s 54 would have run')
    expect(v.holdLine).toBe('but 3 of the 44 are root cause: ours → held for Dana · net 41')
    expect(v.net).toBe(41)
  })

  it('has no hold line when nothing is held', () => {
    const v = previewView({ rule_id: 'rule_t1_reprocessing', mode: 'auto', max_cents: null, would_run: 42, total: 53, baseline_would_run: 41, held_by_root_cause: {} })
    expect(v.headline).toBe('41 → 42 of this week’s 53 would have run')
    expect(v.holdLine).toBeNull()
  })

  it('writes before → after for the keys that changed, with modes in people’s words', () => {
    const lines = changeDiff({ id: 'c', rule_id: 'r', at: '2026-10-28T10:40:00-04:00', by: 'usr_morgan', before: { mode: 'auto', signed_by: 'usr_morgan', max_cents: null }, after: { mode: 'ask', signed_by: 'usr_morgan', max_cents: null }, items_affected_since: 0, summary: '' })
    expect(lines).toEqual(['mode: Runs without review → Ask Dana'])
  })

  it('counts the weekly digest over the 7 days before the server clock', () => {
    const now = '2026-10-28T10:40:00-04:00'
    const c = (at: string, n: number) => ({ id: at, rule_id: 'r', at, by: 'usr_dana', before: {}, after: {}, items_affected_since: n, summary: '' })
    const d = weeklyDigest([c('2026-10-27T17:05:00-04:00', 0), c('2026-10-26T10:02:00-04:00', 2), c('2026-09-14T12:10:00-04:00', 14)], now, 1)
    expect(d).toMatchObject({ changes: 2, ran: 2, awaiting: 1 })
    expect(d.text).toBe('Mon digest to Dr. Morgan: 2 changes · 2 ran under them · 1 awaits sign-off')
  })
})
