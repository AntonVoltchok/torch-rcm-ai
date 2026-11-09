import { describe, expect, it } from 'vitest'
import { CLAIM_STATUSES } from '@/api/schema'
import { MockDb, SEED_FILED_SINCE_REMIT } from './db'
import { GROUP_DELTA_PA } from './fixtures/inbox'
import parity from './fixtures/parity.json'

/**
 * The mock's D1 values equal the API's on the canonical seed (plan d1-build decision 7). `fixtures/parity.json` is
 * written and checked by the API (`apps/api/tests/test_mock_parity.py`), so a rule changed on either side fails here.
 */
// #4512 carries run_bg_hill_rep, the mock's stand-in background run (the API seed has none); #4848 is a pinned Aetna
// claim in the mock and a generated Guardian claim in the API.
const MOCK_ONLY_CLAIMS = new Set(['4512', '4848'])

function setup() {
  return new MockDb({ stepDelayMs: 0, schedule: () => undefined })
}

/** A mock whose runs can be driven to their end: scheduled steps queue up and `drain()` runs them all. */
function runnable() {
  const queue: (() => void)[] = []
  const db = new MockDb({ stepDelayMs: 0, schedule: (fn) => void queue.push(fn) })
  const drain = () => {
    for (let n = 0; queue.length && n < 10_000; n++) queue.shift()?.()
  }
  return { db, drain }
}

const LATER_APPROVALS = [['itm_4705', 'usr_dana'], ['itm_4851', 'usr_dana'], ['itm_4772', 'usr_dana'], ['itm_4748', 'usr_dana'], ['itm_4611', 'usr_morgan']] as const

/** The mock's generated background population has the API's size and mix but its own claim numbers, so claims are
 * compared where both sides have the number (every pinned demo claim), and the population through the KPI rows. */
function shared(db: MockDb, api: Record<string, unknown>) {
  const rows = db.claims({ limit: 10_000 }).items
  const both = rows.filter((c) => String(c.number) in api && !MOCK_ONLY_CLAIMS.has(String(c.number)))
  return {
    mock: Object.fromEntries(both.map((c) => [String(c.number), c.move])),
    api: Object.fromEntries(both.map((c) => [String(c.number), api[String(c.number)]])),
  }
}

/** The API's KPI rows with the mock's stand-in run applied: #4512 is pending and with the agents in the mock only. */
function withStandIn(db: MockDb, moves: typeof parity.seed.moves) {
  const c = db.claims({ limit: 10_000 }).items.find((x) => x.number === 4512)
  if (!c) return moves
  return moves.map((m) => {
    const delta = m.who === 'agents' ? 1 : m.who === c.move.who || m.who !== 'payer' ? 0 : -1
    if (!delta) return m
    const by_status = m.by_status.map((b) => (b.status === c.status ? { ...b, count: b.count + delta } : b))
    if (delta > 0 && !by_status.some((b) => b.status === c.status)) by_status.push({ status: c.status, count: 1 })
    const order = (st: string) => CLAIM_STATUSES.indexOf(st as (typeof CLAIM_STATUSES)[number])
    const rows = by_status.filter((b) => b.count > 0).sort((x, y) => order(x.status) - order(y.status))
    return { ...m, count: m.count + delta, cents: m.cents + delta * c.billed_cents, by_status: rows }
  })
}

describe('mock ↔ API parity on the canonical seed', () => {
  it('the Denials payer × reason matrix', () => {
    expect(setup().denials('usr_dana').matrix).toEqual(parity.seed.denials_matrix)
  })

  it('whose move on every claim both sides have', () => {
    const { mock, api } = shared(setup(), parity.seed.claims)
    expect(Object.keys(mock).length).toBeGreaterThan(25)
    expect(mock).toEqual(api)
    expect([...SEED_FILED_SINCE_REMIT].sort()).toEqual(parity.seed.filed_since_remit)
  })

  it('the KPI moves', () => {
    const db = setup()
    expect(db.strip().moves).toEqual(withStandIn(db, parity.seed.moves))
  })

  it('each item’s words, headline, learnable and track record; each group’s words and headline', () => {
    const db = setup()
    const inbox = db.inbox({})
    const words = Object.fromEntries(
      inbox.items.map((i) => [
        i.id,
        { action_label: i.action_label, touches: i.touches, lands: i.lands, signer_note: i.signer_note, signer_user_id: i.signer_user_id, headline: i.headline, learnable: i.learnable, confidence: i.confidence },
      ]),
    )
    expect(words).toEqual(parity.seed.items)
    const morgan = Object.fromEntries(db.inbox({}, 'usr_morgan').items.map((i) => [i.id, i.signer_note]))
    expect(morgan).toEqual(parity.seed.signer_note_morgan)
    // the mock keys its group by action, the API by denial reason; the words are what must agree
    expect((inbox.groups ?? []).map((g) => ({ action_label: g.action_label, touches: g.touches, headline: g.headline }))).toEqual(Object.values(parity.seed.groups))
  })

  it('Approve 3: changes, moves and the three claims; then #4733', () => {
    const db = setup()
    const res = db.approveGroup(GROUP_DELTA_PA, 'usr_dana')
    expect(res.changes).toEqual(parity.group_approve.changes)
    expect(res.meta.counts.moves).toEqual(withStandIn(db, parity.group_approve.moves))
    const { mock, api } = shared(db, parity.group_approve.claims)
    expect(Object.keys(mock)).toHaveLength(3)
    expect(mock).toEqual(api)
    expect(db.approve('itm_4733', 'usr_dana').changes).toEqual(parity.approve_4733.changes)
  })

  it('every canonical approval, run to its end: where each run left its claim', () => {
    const { db, drain } = runnable()
    const runs: Record<string, string> = {}
    for (const r of db.approveGroup(GROUP_DELTA_PA, 'usr_dana').items) runs[r.id] = r.run_id ?? ''
    runs.itm_4733 = db.approve('itm_4733', 'usr_dana').item.run_id ?? ''
    for (const [id, user] of LATER_APPROVALS) runs[id] = db.approve(id, user).item.run_id ?? ''
    drain()
    const claims = db.claims({ limit: 10_000 }).items
    const got = Object.fromEntries(
      Object.entries(runs).map(([id, runId]) => {
        const { run } = db.run(runId)
        const claim = claims.find((c) => c.id === run.claim_id)
        return [id, { status: run.status, move_to: run.claim_outcome?.move_to ?? null, claim_move: claim?.move }]
      }),
    )
    expect(got).toEqual(parity.approve_runs)
  })
})
