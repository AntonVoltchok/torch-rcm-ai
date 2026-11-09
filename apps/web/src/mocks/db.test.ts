import { describe, expect, it } from 'vitest'
import { CLAIM_STATUSES, InboxItem, InboxItemDetail, InboxList, RunDetail } from '@/api/schema'
import { MockDb, MockError } from './db'
import { GROUP_DELTA_PA } from './fixtures/inbox'

/** The mock must obey the same invariants as the API (docs/spec/01-domain-model.md "Invariants"), or the demo lies. */
function setup() {
  const queue: (() => void)[] = []
  const db = new MockDb({ stepDelayMs: 0, schedule: (fn) => queue.push(fn) })
  const drain = () => {
    for (let n = 0; queue.length && n < 10_000; n++) queue.shift()?.()
  }
  return { db, drain }
}

function invariants(db: MockDb) {
  const strip = db.strip()
  const claims = db.claims({ limit: 10_000 }).items
  for (const s of CLAIM_STATUSES) {
    const group = claims.filter((c) => c.status === s)
    const tile = strip.tiles.find((t) => t.status === s)
    expect(tile).toMatchObject({ count: group.length, cents: group.reduce((a, c) => a + c.billed_cents, 0), flagged: group.filter((c) => c.needs_action).length })
  }
  const open = db.inbox({}).items
  expect(strip.inbox_open).toBe(open.length)
  for (const c of claims) expect(c.needs_action).toBe(open.some((i) => i.claim?.id === c.id))
  // D1's whose-move numbers add up, as the API's test_invariants `move_totals`.
  expect(strip.moves.map((m) => m.who)).toEqual(['practice', 'agents', 'payer', 'nobody'])
  expect(strip.moves.reduce((a, m) => a + m.count, 0)).toBe(strip.open_count)
  expect(strip.moves.reduce((a, m) => a + m.cents, 0)).toBe(strip.open_cents)
  for (const m of strip.moves) expect(m.by_status.reduce((a, b) => a + b.count, 0)).toBe(m.count)
  for (const t of strip.tiles) expect(t.by_holder.reduce((a, h) => a + h.count, 0)).toBe(t.count)
  const openClaims = claims.filter((c) => c.status !== 'paid')
  for (const m of strip.moves) expect(openClaims.filter((c) => c.move.who === m.who).length).toBe(m.count)
  expect(strip.inbox_claims).toBe(new Set(open.flatMap((i) => (i.claim ? [i.claim.id] : []))).size)
}

describe('mock API', () => {
  it('holds the invariants at 10:40', () => {
    invariants(setup().db)
  })

  it('demo step 3: Approve 3 → inbox 9, Denied stays 5, runs stream four steps and an audit line', () => {
    const { db, drain } = setup()
    const res = db.approveGroup(GROUP_DELTA_PA, 'usr_dana')
    expect(res.meta.counts.inbox_open).toBe(9)
    expect(res.meta.counts.tiles.find((t) => t.status === 'denied')).toMatchObject({ count: 5, flagged: 2 })
    drain()
    const { run, evidence } = db.run(res.runs[0]?.id ?? '')
    expect(run.status).toBe('succeeded')
    expect(run.steps?.map((s) => s.name)).toEqual(['act:fetch_image', 'act:nea_upload', 'act:write_remarks', 'act:queue_for_file'])
    expect(evidence[0]?.kind).toBe('nea_attachment')
    expect(run.audit_line).toContain('until the 11:15 file leaves')
    expect(db.claim('clm_4821')).toMatchObject({ open_inbox_items: [], claim: { in_flight: 'resubmit queued · leaves 11:15' } })
    invariants(db)
  })

  it('replays only events after Last-Event-ID', () => {
    const { db, drain } = setup()
    const { run } = db.approve('itm_4705', 'usr_dana')
    if (!run) throw new Error('approving a claim item starts a run')
    drain()
    const all = db.subscribeRun(run.id, null, () => undefined).replay
    const after = db.subscribeRun(run.id, all[2]?.id ?? 0, () => undefined).replay
    expect(after.map((e) => e.id)).toEqual(all.slice(3).map((e) => e.id))
    expect(all.at(-1)?.event).toBe('done')
  })

  it('demo step 3b: triage on #4744 proposes, never runs, and adds exactly one item', () => {
    const { db, drain } = setup()
    const { run } = db.triage('clm_4744', 'usr_dana')
    drain()
    const done = db.run(run.id).run
    expect(done.planner).toBe('recorded_plan')
    expect(done.model_situation_label).toBe('payer asks for missing-tooth history')
    expect(done.steps?.find((s) => s.name === 'decide')?.policy_verdict).toBe('propose')
    expect(done.steps?.find((s) => s.name === 'investigate')?.progress_lines).toContain('read portal correspondence 10/22')
    expect(db.strip().inbox_open).toBe(13)
    expect(() => db.triage('clm_4744', 'usr_dana')).toThrow(MockError)
  })

  it('speaks the API’s wire shapes: InboxItemOut, InboxItemDetail, RunDetail (strict Zod parses)', () => {
    const { db, drain } = setup()
    const list = InboxList.parse(db.inbox({}))
    const pa = list.items.find((i) => i.id === 'itm_4821')
    expect(pa).toMatchObject({ claim: { id: 'clm_4821', number: 4821, payer: { key: 'delta_ny' } }, patient: { display_name: 'K. Owens' }, evidence_ids: ['ev_4821_portal', 'ev_4821_pms', 'ev_4821_era', 'ev_4821_ivr', 'ev_4821_rep'] })
    expect(pa).not.toHaveProperty('evidence')
    expect(list.items.find((i) => i.id === 'itm_elig_chen')).toMatchObject({ claim: null, patient: { id: 'pat_chen_j' } })
    const detail = InboxItemDetail.parse(db.inboxItem('itm_4821'))
    expect(detail.evidence.map((e) => e.id)).toEqual(['ev_4821_portal', 'ev_4821_pms', 'ev_4821_era', 'ev_4821_ivr', 'ev_4821_rep'])
    expect(detail.plan_steps).toHaveLength(4)
    const { run } = db.approve('itm_4705', 'usr_dana')
    drain()
    const rd = RunDetail.parse(db.run(run?.id ?? ''))
    expect(rd.run.status).toBe('succeeded')
    expect(rd.last_event_id).toBeGreaterThan(0)
    expect(rd.run).not.toHaveProperty('evidence')
    expect(() => InboxItem.parse({ ...pa, claim_id: 'clm_4821' })).toThrow()
  })

  it('answers 409 claim_busy while a run holds the claim, for an item or its whole group, then lets it through', () => {
    const { db } = setup()
    const claim = (id: string) => db.inbox({}).items.find((i) => i.id === id)?.claim?.id ?? ''
    db.holdRun(claim('itm_4705'))
    expect(db.inbox({}).items.find((i) => i.id === 'itm_4705')?.claim?.move.who).toBe('agents') // the lock the Inbox draws
    try {
      db.approve('itm_4705', 'usr_dana')
      expect.unreachable()
    } catch (e) {
      expect((e as MockError).status).toBe(409)
      expect((e as MockError).code).toBe('claim_busy')
      expect((e as MockError).message).toMatch(/^Agents are working on #4705\. Approve again when they finish\.$/)
    }
    db.holdRun(claim('itm_4836'), 'paused')
    expect(() => db.approveGroup(GROUP_DELTA_PA, 'usr_dana')).toThrow(/Agents are paused with a run open on #4836/)
    expect(db.inbox({}).items.filter((i) => i.group_key === GROUP_DELTA_PA && i.state === 'open')).toHaveLength(3) // nothing approved
  })

  it('refuses what the server refuses', () => {
    const { db } = setup()
    expect(() => db.alwaysAutoRun('itm_4821')).toThrow(/Root cause: ours/)
    expect(() => db.alwaysAutoRun('itm_4772')).toThrow(/The owner sets this rule/) // tier 2: the same words the Inbox shows up front
    db.approve('itm_4705', 'usr_dana')
    expect(() => db.approve('itm_4705', 'usr_dana')).toThrow(/Already/)
    db.departFile('itm_4851', '10:45')
    try {
      db.approve('itm_4851', 'usr_dana')
    } catch (e) {
      expect((e as MockError).code).toBe('file_departed')
      expect((e as MockError).alternatives).toEqual(['corrected_claim'])
    }
    expect(() => db.pause('usr_dana')).toThrow(/owner/)
  })
})

describe('Claims quick-view counts are the lists’ totals (as test_server_totals.py on the API)', () => {
  it('all_count is the unfiltered list, the Paid tile the paid list, per location and after a mutation', () => {
    const { db, drain } = setup()
    const check = () => {
      for (const loc of [undefined, 'loc_downtown', 'loc_riverside']) {
        const s = db.strip(loc)
        expect(s.all_count).toBe(db.claims({ limit: 1, location_id: loc ?? null }).total)
        expect(s.paid_month_count).toBe(db.claims({ status: ['paid'], limit: 1, location_id: loc ?? null }).total)
        expect(s.all_count).toBe(s.open_count + s.paid_month_count)
      }
    }
    check()
    const res = db.approveGroup(GROUP_DELTA_PA, 'usr_dana')
    expect(res.meta.counts.all_count).toBe(db.claims({ limit: 1 }).total)
    drain()
    check()
  })
})
