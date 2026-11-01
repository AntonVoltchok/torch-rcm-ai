import { describe, expect, it } from 'vitest'
import { CLAIM_STATUSES } from '@/api/schema'
import { MockDb, MockError } from './db'
import { GROUP_DELTA_PA } from './fixtures/inbox'
import { THURSDAY_0710 } from './fixtures/static'

/** S2: the mock server's Settings, static screens and demo step 8 must derive what the API derives. */
function setup() {
  const queue: (() => void)[] = []
  const db = new MockDb({ stepDelayMs: 0, schedule: (fn) => queue.push(fn) })
  const drain = () => {
    for (let n = 0; queue.length && n < 100_000; n++) queue.shift()?.()
  }
  return { db, drain }
}

const err = (fn: () => unknown): MockError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof MockError) return e
    throw e
  }
  throw new Error('expected a MockError')
}

/** Strip = GROUP BY status; needs_action = an open item references the claim; inbox = the viewer's open queue. */
function invariants(db: MockDb) {
  const strip = db.strip()
  const claims = db.claims({ limit: 10_000 }).items
  for (const s of CLAIM_STATUSES) {
    const group = claims.filter((c) => c.status === s)
    expect(strip.tiles.find((t) => t.status === s)).toMatchObject({ count: group.length, cents: group.reduce((a, c) => a + c.billed_cents, 0) })
  }
  expect(strip.inbox_open).toBe(db.inbox({}).items.length)
  expect(strip.ar_cents).toBe(strip.tiles.filter((t) => !['ready', 'paid'].includes(t.status)).reduce((a, t) => a + t.cents, 0))
}

/** Demo steps 3 and 3b, which step 6's numbers include. */
function throughStep3b() {
  const t = setup()
  t.db.approveGroup(GROUP_DELTA_PA, 'usr_dana')
  t.drain()
  t.db.triage('clm_4744', 'usr_dana')
  t.drain()
  return t
}

describe('mock Settings › Agents', () => {
  it('tallies this week as 53 decisions: 41 ran without review, 12 to a person (04-seed)', () => {
    const { db } = setup()
    expect(db.rules().this_week).toEqual({ total: 53, ran: 41, to_you: 12 })
    expect(db.rules().tiers.map((t) => t.rows.length)).toEqual([9, 7, 3])
    const a = db.activity({})
    expect(a.by_tier).toEqual({ '1': { ran: 29, to_dana: 5 }, '2': { ran: 12, to_dana: 3 }, '3': { ran: 0, to_dana: 1 }, none: { ran: 0, to_dana: 3 } })
    expect(a.summary).toMatchObject({ ran_without_you: 41, awaiting_you: 12, decisions: 53 })
  })

  it('demo step 6: the Delta missing-PA rule at “Runs without review” previews 41 → 44 of 54, the ours guard holding 3', () => {
    const { db } = throughStep3b()
    const p = db.preview('rule_t1_delta_pa', 'auto')
    expect(p).toMatchObject({ baseline_would_run: 41, would_run: 41, total: 54, held_by_root_cause: { ours: 3 } })
    expect(p.would_run + (p.held_by_root_cause.ours ?? 0)).toBe(44)
  })

  it('derives the preview from the week’s decisions, not a script', () => {
    const { db } = setup()
    expect(db.preview('rule_t1_status_check', 'auto')).toMatchObject({ would_run: 41, total: 53, held_by_root_cause: {} }) // routine: not a decision
    expect(db.preview('rule_t1_reprocessing', 'auto').would_run).toBe(42) // #4705 would have run
    const capped = db.preview('rule_t1_reprocessing', 'auto', 100_000) // #4705 is $1,150: over a $1,000 cap
    expect(capped.held_by_root_cause.over_cap).toBeGreaterThan(0)
    expect(capped.would_run + (capped.held_by_root_cause.over_cap ?? 0)).toBe(42)
    expect(db.preview('rule_t1_send_claim', 'ask').would_run).toBe(32) // the 9 sends would have come to Dana
    expect(db.preview('rule_t3_formal_appeal', 'auto').would_run).toBe(41) // tier 3 never runs
  })

  it('demo step 7: a tier-2 change by Dana becomes Dr. Morgan’s sign-off item (her badge only); by Morgan it applies, signed', () => {
    const { db } = setup()
    const e = err(() => db.patchRule('rule_t2_post_era', { mode: 'ask' }, 'usr_dana'))
    expect(e.status).toBe(409)
    expect(e.code).toBe('owner_signoff_required')
    expect(db.strip(undefined, 'usr_dana').inbox_open).toBe(12)
    expect(db.strip(undefined, 'usr_morgan').inbox_open).toBe(13)
    expect(db.rules().tiers[1]?.rows.find((r) => r.rule.id === 'rule_t2_post_era')?.rule.mode).toBe('auto') // unchanged
    const res = db.patchRule('rule_t2_post_era', { mode: 'ask' }, 'usr_morgan')
    expect(res.rule).toMatchObject({ mode: 'ask', signed_by: 'usr_morgan', version: 2 })
    expect(db.ruleChanges().items[0]).toMatchObject({ rule_id: 'rule_t2_post_era', by: 'usr_morgan', before: { mode: 'auto' }, after: { mode: 'ask' } })
  })

  it('signing the sign-off item applies the requested change with no run', () => {
    const { db } = setup()
    const e = err(() => db.patchRule('rule_t2_post_era', { mode: 'observe' }, 'usr_dana'))
    const itemId = String(e.details.inbox_item_id)
    expect(err(() => db.approve(itemId, 'usr_dana')).code).toBe('tier_requires_owner')
    const res = db.approve(itemId, 'usr_morgan')
    expect(res.run).toBeNull()
    expect(res.rule).toMatchObject({ mode: 'observe', signed_by: 'usr_morgan' })
    expect(db.strip(undefined, 'usr_morgan').inbox_open).toBe(12)
  })

  it('tier 3 is human only, and a tier-1 change by billing applies directly', () => {
    const { db } = setup()
    expect(err(() => db.patchRule('rule_t3_formal_appeal', { mode: 'auto' }, 'usr_morgan')).code).toBe('human_only')
    expect(err(() => db.patchRule('rule_t1_status_check', { mode: 'auto' }, 'usr_tasha')).code).toBe('forbidden')
    expect(db.patchRule('rule_t1_status_check', { mode: 'auto' }, 'usr_dana').rule.mode).toBe('auto')
  })

  it('accepting the Delta proposal adds a learned, signed tier-1 rule; the ours sibling and the n = 1 card are refused', () => {
    const { db } = setup()
    const res = db.acceptProposal('prop_delta_pa', 'usr_morgan')
    expect(res.rule).toMatchObject({ origin: 'learned', mode: 'auto', tier: 1, signed_by: 'usr_morgan', outcome_metric: 'paid_30d', scope: { max_cents: 200_000 } })
    expect(db.rules().tiers[0]?.rows.some((r) => r.rule.id === res.rule.id && r.signed_by_name === 'Dr. Morgan')).toBe(true)
    expect(err(() => db.acceptProposal('prop_delta_pa_ours', 'usr_morgan')).code).toBe('root_cause_guard')
    expect(err(() => db.acceptProposal('prop_guardian_5mm', 'usr_morgan')).code).toBe('not_enough_evidence')
    expect(err(() => db.acceptProposal('prop_delta_pa', 'usr_morgan')).code).toBe('already_resolved')
    expect(db.proposals().items.map((p) => p.state)).toEqual(['open', 'open', 'accepted'])
  })
})

describe('mock static screens at Wed 10:40', () => {
  it('Today’s claims: 5 sent ($1,320), 3 leaving at 10:45 plus Haddad’s resend, 3 held by days left, Ortega UR not billable', () => {
    const { db } = setup()
    const l = db.ledger()
    expect(l.sent.map((r) => r.claim.number)).toEqual([4857, 4864, 4860, 4863, 4866])
    expect(l.sent.reduce((a, r) => a + r.claim.billed_cents, 0)).toBe(132_000)
    expect(l.leaving_next_file.map((r) => r.claim.number)).toEqual([4855, 4856, 4859, 4854])
    expect(l.leaving_next_file[0]?.editable_until).toBe('2026-10-28T10:44:00-04:00')
    expect(l.held.map((r) => [r.claim.number, r.timely_days_left])).toEqual([[4847, 89], [4842, 174], [4849, 179]])
    expect(l.not_billable).toHaveLength(1)
    expect(l.next_file_time).toBe('2026-10-28T10:45:00-04:00')
  })

  it('Eligibility: Thu–Fri appointments; J. Chen’s card splits $650 into $180 insurance / $470 patient', () => {
    const { db } = setup()
    const e = db.eligibility()
    expect(e.date).toBe('2026-10-29')
    expect(e.need_human).toBe(3)
    const chen = db.benefits('appt_chen_1029')
    expect(chen).toMatchObject({ planned_fee_cents: 65_000, insurance_est_cents: 18_000, patient_est_cents: 47_000, coverage: { remaining_max_cents: 18_000, used_cents: 132_000 } })
    expect(db.eligibility('2026-10-30').rows.every((r) => r.start.startsWith('2026-10-30'))).toBe(true)
  })

  it('Cash: owner only; days in A/R 27 from the same A/R as the strip; agent impact is labelled an estimate', () => {
    const { db } = setup()
    expect(err(() => db.cash('usr_dana')).status).toBe(403)
    const c = db.cash('usr_morgan')
    expect(c.kpis.find((k) => k.key === 'days_in_ar')?.value).toBe(27)
    expect(c.kpis.find((k) => k.key === 'insurance_ar')?.value).toBe(db.strip().ar_cents)
    expect(c.aging.reduce((a, b) => a + b.cents, 0)).toBe(db.strip().ar_cents)
    expect(c.agent_impact).toMatchObject({ items_auto: 41, items_to_you: 12, hours_saved_est: { value: 6.2 } })
    expect(c.agent_impact.hours_saved_est.basis).toContain('estimate')
  })

  it('Denials: 5 denied claims routed by CARC; front desk is refused', () => {
    const { db } = setup()
    const d = db.denials('usr_dana')
    expect(d.total).toBe(db.strip().tiles.find((t) => t.status === 'denied')?.count)
    expect(d.groups.map((g) => [g.next_action, g.rows.map((r) => r.claim.number)])).toEqual([
      ['reconsideration', [4733, 4821, 4836, 4840]],
      ['bill_patient_link', [4611]],
    ])
    expect(d.groups[0]?.rows.find((r) => r.claim.number === 4821)).toMatchObject({ root_cause: 'ours', patient_billable_if_lost: false, deadline: { kind: 'appeal' } })
    expect(err(() => db.denials('usr_tasha')).status).toBe(403)
  })
})

describe('mock demo step 8: skip to Thu 07:10', () => {
  it('plays the overnight: Owens group leaves 11:15 (stays denied, in flight), four denials, six paid, Inbox 16, Denied 9', () => {
    const { db, drain } = throughStep3b()
    expect(db.strip().inbox_open).toBe(10)
    const { advance_id } = db.advanceClock(THURSDAY_0710, 'usr_morgan')
    expect(err(() => db.advanceClock(THURSDAY_0710, 'usr_morgan')).code).toBe('advance_in_progress')
    expect(db.clock.advancing?.advance_id).toBe(advance_id)
    drain()
    const adv = db.advanceStatus(advance_id)
    expect(adv).toMatchObject({ done: true, state: 'done', now: THURSDAY_0710 })
    const kinds = Array.isArray(adv.events_fired) ? adv.events_fired.map((e) => e.kind) : []
    expect(kinds.filter((k) => k === 'claim_denied')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'era_arrived')).toHaveLength(4)
    expect(db.now).toBe(THURSDAY_0710)
    expect(db.clock.advancing).toBeNull()

    const strip = db.strip()
    expect(strip.tiles.find((t) => t.status === 'denied')?.count).toBe(9)
    expect(strip.paid_month_count).toBe(124)
    expect(strip.inbox_open).toBe(16)
    for (const id of ['clm_4821', 'clm_4836', 'clm_4840']) {
      const c = db.claim(id)
      expect(c.status).toBe('denied')
      expect(c.in_flight).toContain('11:15')
    }
    const denials = db.denials('usr_dana')
    const ito = denials.groups.find((g) => g.next_action === 'formal_appeal')?.rows.find((r) => r.claim.number === 4796)
    expect(ito).toMatchObject({ signer: 'Dr. Lee', erisa: true, checklist: ['rendering dentist signs the attestation', 'patient authorization required (ERISA)'] })
    expect(denials.in_flight.map((c) => c.number).sort()).toEqual([4821, 4836, 4840])
    expect(db.ledger()).toMatchObject({ date: '2026-10-29', sent: [], leaving_next_file: [] })
    invariants(db)
  })

  it('the night’s runs land in Activity; Follow-up rows carry their evidence', () => {
    const { db, drain } = setup()
    db.advanceClock(THURSDAY_0710, 'usr_morgan')
    drain()
    const followup = db.activity({ agent: 'followup' }).rows
    expect(followup.some((r) => r.at.startsWith('2026-10-29') && r.evidence_kinds.includes('ivr_transcript'))).toBe(true)
    expect(followup.some((r) => r.action.includes('DD-1027-88412') && r.evidence_kinds.includes('rep_call'))).toBe(true)
    expect(db.activity({ day: '2026-10-29' }).rows.every((r) => r.at.startsWith('2026-10-29'))).toBe(true)
  })

  it('only the first crossing of Thu 07:10 plays the script; later advances just move the clock', () => {
    const { db, drain } = setup()
    db.advanceClock(THURSDAY_0710, 'usr_morgan')
    drain()
    const thursday = db.strip()
    db.advanceClock('2026-10-30T07:10:00-04:00', 'usr_morgan')
    drain()
    expect(db.strip().tiles).toEqual(thursday.tiles.map((t) => ({ ...t })))
    expect(db.now).toBe('2026-10-30T07:10:00-04:00')
  })
})
