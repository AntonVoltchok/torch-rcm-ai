import { describe, expect, it } from 'vitest'
import { EligibilityOut } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { practiceDay } from '@/lib/format'
import { byDay, dayLine } from './selectors'

const mock = () => new MockDb({ stepDelayMs: 0, schedule: () => undefined })

describe('eligibility days', () => {
  it('the mock’s by_day equals its rows, as the API’s does (test_server_totals.py)', () => {
    for (const date of [null, '2026-10-29', '2026-10-31']) {
      const d = EligibilityOut.parse(mock().eligibility(date))
      expect(d.total).toBe(d.rows.length)
      expect(d.by_day.reduce((a, x) => a + x.count, 0)).toBe(d.total)
      for (const day of d.by_day) {
        const rows = d.rows.filter((r) => practiceDay(r.start) === day.date)
        expect(day.count).toBe(rows.length)
        for (const s of ['verified', 'issue', 'unverified', 'checking'] as const) expect(day[s]).toBe(rows.filter((r) => r.status === s).length)
      }
      expect(new Set(d.rows.map((r) => practiceDay(r.start)))).toEqual(new Set(d.by_day.filter((x) => x.count > 0).map((x) => x.date)))
    }
  })

  it('renders every server day, rows picked by date, and words the counts', () => {
    const d = EligibilityOut.parse(mock().eligibility())
    const days = byDay(d)
    expect(days.map((g) => g.day)).toEqual(d.by_day.map((x) => x.date))
    expect(days.flatMap((g) => g.rows)).toHaveLength(d.total)
    expect(dayLine({ date: '2026-10-29', count: 6, verified: 3, issue: 2, unverified: 0, checking: 1 })).toBe('6 appts · 3 verified · 2 need attention · 1 checking')
    expect(dayLine({ date: '2026-10-30', count: 1, verified: 0, issue: 1, unverified: 0, checking: 0 })).toBe('1 appt · 1 needs attention')
    expect(dayLine({ date: '2026-11-02', count: 0, verified: 0, issue: 0, unverified: 0, checking: 0 })).toBe('No appointments booked')
  })
})
