import { describe, expect, it } from 'vitest'
import { Ledger } from '@/api/schema'
import { MockDb } from '@/mocks/db'
import { THURSDAY_0710 } from '@/mocks/fixtures/static'
import { ackChips, fileGroups } from './selectors'

const mock = () => new MockDb({ stepDelayMs: 0, schedule: () => undefined })

/** The mock's totals equal its rows, as the API's do (apps/api/tests/test_server_totals.py). */
function expectTotalsEqualRows(l: Ledger) {
  const sum = (rows: { claim: { billed_cents: number } }[]) => ({ count: rows.length, cents: rows.reduce((a, r) => a + r.claim.billed_cents, 0) })
  expect(l.totals.sent).toEqual(sum(l.sent))
  expect(l.totals.leaving).toEqual(sum(l.leaving_next_file))
  expect(l.totals.held).toEqual(sum(l.held))
  expect(l.totals.not_billable).toEqual({ count: l.not_billable.length, cents: l.not_billable.reduce((a, r) => a + r.fee_cents, 0) })
  expect(l.totals.on_ledger).toBe(l.sent.length + l.leaving_next_file.length + l.held.length)
  const ids = l.files.flatMap((f) => f.claim_ids)
  expect([...ids].sort()).toEqual(l.leaving_next_file.map((r) => r.claim.id).sort())
  for (const g of fileGroups(l)) {
    expect(g.rows.map((r) => r.claim.id)).toEqual(g.file.claim_ids)
    expect(g.file).toMatchObject(sum(g.rows))
    expect(g.rows.every((r) => r.file_time === g.file.file_time)).toBe(true)
  }
}

describe('today’s claims selectors', () => {
  it('reads a fixed A7 as “A7:164 → A1” and groups leaving claims by the server’s files', () => {
    const l = Ledger.parse(mock().ledger())
    const iqbal = l.sent.find((r) => r.claim.number === 4860)
    expect(iqbal && ackChips(iqbal.acks, true).vyne.text).toBe('A7:164 9:49 AM → A1 10:19 AM')
    expect(iqbal && ackChips(iqbal.acks, true).payer).toEqual({ tone: 'pending', text: 'pending' })
    expect(fileGroups(l).map((g) => [g.file.file_time, g.rows.length, g.file.count])).toEqual([['2026-10-28T10:45:00-04:00', 4, 4]])
    expect(l.totals.sent).toEqual({ count: 5, cents: 132_000 })
  })

  it('totals equal the rows on Wednesday and after the Thursday advance', () => {
    const queue: (() => void)[] = []
    const db = new MockDb({ stepDelayMs: 0, schedule: (fn) => queue.push(fn) })
    expectTotalsEqualRows(Ledger.parse(db.ledger()))
    db.advanceClock(THURSDAY_0710, 'usr_morgan')
    for (let n = 0; queue.length && n < 100_000; n++) queue.shift()?.()
    expectTotalsEqualRows(Ledger.parse(db.ledger()))
  })
})
