import { describe, expect, it } from 'vitest'
import { ageTone, clockLabel, dateTime, money, moneyCompact, nyInstant, shortDate } from './format'

describe('money', () => {
  it('formats integer cents as dollars, cents only when present', () => {
    expect(money(124000)).toBe('$1,240')
    expect(money(2720)).toBe('$27.20')
    expect(money(0)).toBe('$0')
    expect(money(6130000)).toBe('$61,300')
  })
  it('uses a real minus sign for negatives (contractual write-off)', () => {
    expect(money(-25400)).toBe('−$254')
  })
  it('renders unknown amounts as a dash, never $0', () => {
    expect(money(null)).toBe('—')
    expect(money(undefined)).toBe('—')
    expect(moneyCompact(null)).toBe('—')
  })
  it('can force or suppress cents', () => {
    expect(money(124000, { cents: 'always' })).toBe('$1,240.00')
    expect(money(2720, { cents: 'never' })).toBe('$27')
  })
  it('refuses non-integer cents (money is never a float)', () => {
    expect(() => money(12.5)).toThrow()
  })
})

describe('dates render in the practice zone (America/New_York)', () => {
  it('formats the frozen clock regardless of the test runner zone', () => {
    expect(clockLabel('2026-10-28T10:40:00-04:00')).toBe('Wed Oct 28 · 10:40 AM')
    expect(dateTime('2026-10-28T14:40:00Z')).toBe('10/28 · 10:40 AM')
  })
  it('treats YYYY-MM-DD as a calendar date, not UTC midnight', () => {
    expect(shortDate('2026-10-12')).toBe('10/12')
  })
  it('builds wall-clock instants across the DST change', () => {
    expect(nyInstant('2026-10-29', '07:10')).toBe('2026-10-29T07:10:00-04:00')
    expect(nyInstant('2026-11-02', '07:10')).toBe('2026-11-02T07:10:00-05:00')
  })
})

describe('age buckets', () => {
  it('colours days since sent', () => {
    expect([ageTone(15), ageTone(31), ageTone(64), ageTone(104), ageTone(null)]).toEqual(['ok', 'warn', 'bad', 'dark', null])
  })
})
