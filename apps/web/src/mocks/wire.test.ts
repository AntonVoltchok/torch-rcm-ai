import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import * as S from '@/api/schema'
import { MockDb, type SseRecord } from './db'
import { GROUP_DELTA_PA } from './fixtures/inbox'
import { THURSDAY_0710 } from './fixtures/static'

/** The mock layer follows the API, never the reverse: everything it serves must parse under the strict generated schemas. */
function setup() {
  const queue: (() => void)[] = []
  const db = new MockDb({ stepDelayMs: 0, schedule: (fn) => queue.push(fn) })
  const drain = () => {
    for (let n = 0; queue.length && n < 100_000; n++) queue.shift()?.()
  }
  return { db, drain }
}

const parses = (schema: z.ZodTypeAny, value: unknown) => {
  const out = schema.safeParse(JSON.parse(JSON.stringify(value)))
  expect(out.success ? [] : out.error.issues).toEqual([])
}

function reads(db: MockDb) {
  parses(S.Clock, db.clock)
  parses(S.StripSummary, db.strip())
  parses(S.AgentsStatus, db.agentsStatus())
  const inbox = db.inbox({})
  parses(S.InboxList, inbox)
  for (const item of inbox.items) parses(S.InboxItemDetail, db.inboxItem(item.id))
  const claims = db.claims({ limit: 10_000 })
  parses(S.ClaimList, { ...claims, total_cents: 0, flagged_count: 0, flagged_cents: 0 })
  for (const c of claims.items) parses(S.ClaimDetail, db.claim(c.id))
  parses(S.ViewList, db.views())
  parses(S.RulesOut, db.rules())
  parses(S.RuleChangeList, db.ruleChanges())
  parses(S.ProposalList, db.proposals())
  parses(S.Preview, db.preview('rule_t1_delta_pa'))
  parses(S.ActivityOut, db.activity({}))
  parses(S.Ledger, db.ledger())
  const eligibility = db.eligibility(null)
  parses(S.EligibilityOut, eligibility)
  for (const row of eligibility.rows) parses(S.BenefitsPanel, db.benefits(row.appointment_id))
  parses(S.CashSummary, db.cash('usr_morgan'))
  parses(S.DenialsOut, db.denials('usr_dana'))
}

function replay(db: MockDb, runId: string): SseRecord[] {
  const sub = db.subscribeRun(runId, null, () => undefined)
  sub.unsubscribe()
  return sub.replay
}

describe('mock responses match the API contract', () => {
  it('every read at Wed 10:40 and after the overnight', () => {
    const { db, drain } = setup()
    reads(db)
    db.advanceClock(THURSDAY_0710, 'usr_morgan')
    drain()
    reads(db)
  })

  it('every mutation, and the SSE frames a run streams', () => {
    const { db, drain } = setup()
    const group = db.approveGroup(GROUP_DELTA_PA, 'usr_dana')
    parses(S.ApproveGroupResponse, group)
    const one = db.approve('inb_4705', 'usr_dana')
    parses(S.ApproveResponse, one)
    parses(S.ItemResponse, db.reject('inb_4733', 'usr_dana', 'not this one'))
    parses(S.CorrectedClaimResponse, db.corrected('clm_4851', 'usr_dana'))
    parses(S.TriageAccepted, db.triage('clm_4744', 'usr_dana'))
    parses(S.AgentsStatus, db.pause('usr_morgan'))
    parses(S.AgentsStatus, db.resume('usr_morgan'))
    parses(S.ClockAdvanceAccepted, db.advanceClock(THURSDAY_0710, 'usr_morgan'))
    drain()

    const runId = group.runs[0]?.id ?? ''
    const frames = replay(db, runId)
    expect(frames.map((f) => f.event)).toContain('done')
    for (const f of frames) {
      if (f.event === 'step') parses(S.RunStepEvent, f.data)
      if (f.event === 'status') parses(S.RunStatusEvent, f.data)
      if (f.event === 'done') parses(S.RunDoneEvent, f.data)
      if (f.event === 'counts') parses(S.StripSummary, f.data)
    }
    parses(S.RunDetail, db.run(runId))
  })
})
