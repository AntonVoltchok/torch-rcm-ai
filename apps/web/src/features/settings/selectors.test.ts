import { describe, expect, it } from 'vitest'
import { RulesOut } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { changeDiff, digestText, floorLabel, previewView, rowView, tierViews, withRuleMode } from './selectors'

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

  it('heads each tier with the server’s tier totals (29 ran in tier 1, 12 in tier 2)', () => {
    const data = rules()
    const views = tierViews(data, 'billing')
    expect(views[0]?.summary).toBe('9 rules · ran 29 · 5 waiting')
    expect(views[1]?.summary).toBe('7 rules · ran 12 · 2 waiting')
    expect(views[2]?.summary).toBe('3 rules · human only · no toggle')
    expect(data.rules_count).toBe(19)
  })

  it('the mock’s tier totals equal its rows, as the API’s do (test_server_totals.py)', () => {
    const data = rules()
    for (const g of data.tiers) {
      expect(g.count).toBe(g.rows.length)
      expect(g.ran_without_review_7d).toBe(g.rows.reduce((a, r) => a + r.ran_without_review_7d, 0))
      expect(g.waiting).toBe(g.rows.reduce((a, r) => a + r.waiting, 0))
    }
    expect(data.rules_count).toBe(data.tiers.reduce((a, t) => a + t.rows.length, 0))
    expect(data.tiers.find((t) => t.tier === 3)?.ran_without_review_7d).toBe(0)
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
    const v = previewView({
      rule_id: 'rule_t1_delta_pa',
      mode: 'auto',
      max_cents: null,
      would_run: 41,
      total: 54,
      baseline_would_run: 41,
      held_by_root_cause: { ours: 3 },
      held_total: 3,
      before_holds: 44,
      net_change: 0,
    })
    expect(v.headline).toBe('41 → 44 of this week’s 54 would have run')
    expect(v.holdLine).toBe('but 3 of the 44 are root cause: ours → held for Dana · net 41')
    expect(v.net).toBe(41)
    expect(v.changeLine).toBe('No change this week.')
  })

  it('has no hold line when nothing is held', () => {
    const v = previewView({
      rule_id: 'rule_t1_reprocessing',
      mode: 'auto',
      max_cents: null,
      would_run: 42,
      total: 53,
      baseline_would_run: 41,
      held_by_root_cause: {},
      held_total: 0,
      before_holds: 42,
      net_change: 1,
    })
    expect(v.headline).toBe('41 → 42 of this week’s 53 would have run')
    expect(v.holdLine).toBeNull()
    expect(v.changeLine).toBe('1 more would have run without review.')
    expect(
      previewView({
        ...v,
        rule_id: 'r',
        mode: 'ask',
        max_cents: null,
        would_run: 39,
        total: 53,
        baseline_would_run: 41,
        held_by_root_cause: {},
        held_total: 0,
        before_holds: 39,
        net_change: -2,
      }).changeLine,
    ).toBe('2 fewer would have run without review.')
  })

  it('writes before → after for the keys that changed, with modes in people’s words', () => {
    const lines = changeDiff({
      id: 'c',
      rule_id: 'r',
      at: '2026-10-28T10:40:00-04:00',
      by: 'usr_morgan',
      before: { mode: 'auto', signed_by: 'usr_morgan', max_cents: null },
      after: { mode: 'ask', signed_by: 'usr_morgan', max_cents: null },
      items_affected_since: 0,
      summary: '',
    })
    expect(lines).toEqual(['mode: Runs without review → Ask Dana'])
  })

  it('words the server’s Monday digest (this week from Monday), and the mock’s digest equals its changes', () => {
    expect(digestText({ period_start: '2026-10-26', sends_on: '2026-11-02', changes: 2, items_run: 2, awaiting_signoff: 1 })).toBe(
      'Mon digest to Dr. Morgan (week of 10/26, so far): 2 changes · 2 ran under them · 1 awaits sign-off',
    )
    const out = new MockDb({ stepDelayMs: 0, schedule: () => undefined }).ruleChanges()
    const week = out.items.filter((c) => c.at >= '2026-10-26')
    expect(out.digest).toEqual({
      period_start: '2026-10-26',
      sends_on: '2026-11-02',
      changes: week.length,
      items_run: week.reduce((a, c) => a + (c.items_affected_since ?? 0), 0),
      awaiting_signoff: 0,
    })
  })
})
