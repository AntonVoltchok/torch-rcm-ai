import { describe, expect, it } from 'vitest'
import { ActivityOut } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { practiceDay } from '@/lib/format'
import { groupByDay } from './selectors'

const mock = () => new MockDb({ stepDelayMs: 0, schedule: () => undefined })

describe('activity days and moves', () => {
  it('the mock’s by_day equals its rows after the filters, as the API’s does (test_server_totals.py)', () => {
    for (const p of [{}, { agent: 'followup' }, { outcome: 'awaiting' }, { day: '2026-10-27' }]) {
      const d = ActivityOut.parse(mock().activity(p))
      const groups = groupByDay(d)
      expect(groups.map((g) => g.rows.length)).toEqual(d.by_day.map((x) => x.count))
      expect(groups.flatMap((g) => g.rows)).toEqual(d.rows)
      expect(new Set(d.rows.map((r) => practiceDay(r.at)))).toEqual(new Set(d.by_day.map((x) => x.date)))
    }
  })

  it('carries the claim’s move now, for the viewer, and none on rows without a claim', () => {
    const db = mock()
    // claims() words moves for Dana, so Dana's Activity rows must carry exactly those moves
    const claims = new Map(db.claims({ limit: 10_000 }).items.map((c) => [c.id, c.move]))
    const d = ActivityOut.parse(db.activity({}, 'usr_dana'))
    expect(d.rows.some((r) => r.move)).toBe(true)
    for (const r of d.rows) {
      if (!r.claim_id) expect(r.move).toBeNull()
      else if (claims.has(r.claim_id)) expect(r.move).toEqual(claims.get(r.claim_id))
    }
    const morgan = ActivityOut.parse(db.activity({}, 'usr_morgan'))
    expect(morgan.rows.map((r) => Boolean(r.move))).toEqual(d.rows.map((r) => Boolean(r.move)))
  })
})
