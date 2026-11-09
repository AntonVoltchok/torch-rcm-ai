import { describe, expect, it } from 'vitest'
import { MockDb } from '@/mocks/db'
import { THURSDAY_0710 } from '@/mocks/fixtures/static'
import { daysUntil, deadlineLabel, deadlineVerb, ifWeLose, pathTier, sortedRows, tag, worklistOrder } from './selectors'

function thursday() {
  const queue: (() => void)[] = []
  const db = new MockDb({ stepDelayMs: 0, schedule: (fn) => queue.push(fn) })
  db.advanceClock(THURSDAY_0710, 'usr_morgan')
  for (let n = 0; queue.length && n < 100_000; n++) queue.shift()?.()
  return db
}

describe('denials worklist selectors', () => {
  const db = thursday()
  const rows = db.denials('usr_morgan').groups.flatMap((g) => g.rows)
  const by = (n: number) => {
    const r = rows.find((x) => x.claim.number === n)
    if (!r) throw new Error(`#${n} not on the worklist`)
    return r
  }

  it('tags ours/theirs and says whether the patient can be billed if we lose', () => {
    expect(tag(by(4821))).toBe('ours')
    expect(tag(by(4796))).toBe('theirs')
    expect(ifWeLose(by(4796))).toBe('patient cannot be billed')
    expect(ifWeLose(by(3561))).toBe('patient cannot be billed → non-contractual write-off')
    expect(ifWeLose(by(4611))).toBe('patient can be billed')
  })

  it('gives each path its tier: a formal appeal commits the practice; a drafted inquiry is tier 2', () => {
    expect(pathTier(by(4796))).toBe(3)
    expect(pathTier(by(4821))).toBe(1)
    expect(pathTier(by(4733))).toBe(2)
    expect(pathTier(by(4611))).toBe(3)
  })

  it('types deadlines and counts days on the server clock', () => {
    expect(deadlineLabel(by(4796), '2026-10-29')).toEqual({ text: 'appeal · 180 d', days: 180 })
    expect(deadlineLabel(by(3561), '2026-10-29')).toEqual({ text: 'appeal · 180 d', days: 180 })
    expect(deadlineLabel(by(4800), '2026-10-29').text).toBe('timely · 349 d')
    expect(deadlineLabel(by(4797), '2026-10-29')).toEqual({ text: 'records request · no payer deadline', days: null })
  })

  it("sends a payer × reason matrix equal to the rows, leaving plan limits out (the browser adds nothing)", () => {
    const d = db.denials('usr_morgan')
    const m = d.matrix
    const keys = m.columns.map((c) => c.key)
    const want = new Map<string, number>()
    const reason: Record<string, string> = { 'CO-16': 'doc', 'CO-119': 'freq', 'CO-22': 'cob', 'CO-29': 'tf', 'CO-50': 'med_nec' }
    for (const r of rows) {
      if (r.carc.startsWith('PR-')) continue
      const k = `${r.claim.payer.key}:${reason[r.carc] ?? 'other'}`
      want.set(k, (want.get(k) ?? 0) + 1)
    }
    const got = new Map<string, number>()
    for (const p of m.payers) {
      expect(p.cells.map((c) => c.reason)).toEqual(keys)
      expect(p.total).toBe(p.cells.reduce((a, c) => a + c.count, 0))
      for (const c of p.cells) if (c.count) got.set(`${p.payer.key}:${c.reason}`, c.count)
    }
    expect(got).toEqual(want)
    expect(m.totals.map((c) => c.reason)).toEqual(keys)
    expect(m.total + m.excluded).toBe(d.total)
    expect(m.excluded).toBe(1) // #4611 PR-119 is a plan limit
    const delta = m.payers.find((p) => p.payer.key === 'delta_ny')
    expect(Object.fromEntries(delta?.cells.filter((c) => c.count).map((c) => [c.reason, c.count]) ?? [])).toEqual({ doc: 3, freq: 1 })
    expect(m.totals.find((c) => c.reason === 'tf')?.count).toBe(1)
  })
})

describe('worklist order and deadlines', () => {
  it('sorts rows by deadline inside the server groups, undated last', async () => {
    const { MockDb: Db } = await import('@/mocks/db')
    const d = new Db({ stepDelayMs: 0, schedule: () => undefined }).denials('usr_dana')
    const order = worklistOrder(d)
    expect(order).toHaveLength(d.total)
    for (const g of d.groups) {
      const due = sortedRows(g.rows).map((r) => r.deadline.due_on ?? '9999-12-31')
      expect(due).toEqual([...due].sort())
    }
  })

  it('counts days at noon UTC on both dates, so no timezone moves a day', () => {
    expect(daysUntil('2027-04-20', '2026-10-28')).toBe(174)
    expect(daysUntil('2026-10-28', '2026-10-28')).toBe(0)
    expect(deadlineVerb('timely_filing')).toBe('File by')
    expect(deadlineVerb('appeal')).toBe('Appeal by')
  })
})
