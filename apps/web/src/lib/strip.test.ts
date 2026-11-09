import { describe, expect, it } from 'vitest'
import { StripSummary } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { navBadge, stripTiles, tileFor } from './strip'

/** The strip as the canonical seed must produce it at Wed 10/28 10:40 (docs/spec/04-seed.md). */
describe('strip selectors', () => {
  const strip = StripSummary.parse(new MockDb({ stepDelayMs: 0, schedule: () => undefined }).strip())

  it('reads the tiles in lifecycle order with the month label on Paid', () => {
    expect(stripTiles(strip).map((t) => `${t.label} ${t.count} ${t.cents / 100}`)).toEqual([
      'Ready 6 3210',
      'Sent 5 1320',
      'Rejected 2 830',
      'Accepted 24 17640',
      'Pending 57 46520',
      'Denied 5 6210',
      'Partial 5 1060',
      'Appealed 3 1920',
      'Paid · Oct 118 61300',
    ])
  })

  it('carries the header totals as server fields', () => {
    expect([strip.open_count, strip.open_cents]).toEqual([107, 7_871_000])
    expect([strip.ar_count, strip.ar_cents]).toEqual([101, 7_550_000])
  })

  it('leaves out a tile the server did not send instead of inventing a 0', () => {
    const partial = { ...strip, tiles: strip.tiles.filter((t) => t.status !== 'appealed') }
    expect(tileFor(partial, 'appealed')).toBeUndefined()
    expect(stripTiles(partial).map((t) => t.status)).not.toContain('appealed')
  })

  it('flags 9 claims, which with 3 eligibility items make a queue of 12: 11 need Dana, 1 waits on Dr. Morgan', () => {
    expect(strip.flagged_count).toBe(9)
    expect(navBadge(strip, 'inbox')).toBe(11)
    expect(strip.inbox_waiting).toEqual([{ signer_ids: ['usr_morgan'], label: 'Dr. Morgan', count: 1, cents: 124_000 }])
    expect(navBadge(strip, 'eligibility')).toBe(3)
    expect(navBadge(strip, 'payments')).toBe(3)
    expect(navBadge(strip, 'activity')).toBe(41)
    expect(navBadge(undefined, 'inbox')).toBeNull()
  })
})
