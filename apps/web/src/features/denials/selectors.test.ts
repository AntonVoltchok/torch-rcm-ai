import { describe, expect, it } from 'vitest'
import { Ledger } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { THURSDAY_0710 } from '@/mocks/fixtures/static'
import { ackChips, fileGroups } from '@/features/ledger/selectors'
import { deadlineLabel, ifWeLose, pathTier, payerReasonMatrix, tag } from './selectors'

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
  })

  it('types deadlines and counts days on the server clock', () => {
    expect(deadlineLabel(by(4796), '2026-10-29')).toEqual({ text: 'appeal · 180 d', days: 180 })
    expect(deadlineLabel(by(3561), '2026-10-29')).toEqual({ text: 'appeal · 180 d', days: 180 })
    expect(deadlineLabel(by(4800), '2026-10-29').text).toBe('timely · 349 d')
    expect(deadlineLabel(by(4797), '2026-10-29')).toEqual({ text: 'records request · no payer deadline', days: null })
  })

  it('builds the payer × reason matrix from the rows, leaving plan limits out', () => {
    const m = payerReasonMatrix(rows)
    expect(m.total).toBe(rows.length - 1) // #4611 PR-119 is a plan limit
    expect(m.excluded).toBe(1)
    expect(m.payers.find((p) => p.key === 'delta_ny')?.cells).toEqual({ Doc: 3, Freq: 1 })
    expect(m.totals.TF).toBe(1)
  })
})

describe('today’s claims selectors', () => {
  it('reads a fixed A7 as “A7:164 → A1” and groups leaving claims by file time', () => {
    const db = new MockDb({ stepDelayMs: 0, schedule: () => undefined })
    const l = Ledger.parse(db.ledger())
    const iqbal = l.sent.find((r) => r.claim.number === 4860)
    expect(iqbal && ackChips(iqbal.acks, true).vyne.text).toBe('A7:164 9:49 AM → A1 10:19 AM')
    expect(iqbal && ackChips(iqbal.acks, true).payer).toEqual({ tone: 'pending', text: 'pending' })
    expect(fileGroups(l.leaving_next_file).map((g) => [g.file_time, g.rows.length])).toEqual([['2026-10-28T10:45:00-04:00', 4]])
  })
})
