import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { api } from '@/api/endpoints'
import * as S from '@/api/schema'
import { session } from '@/state/session'
import { GROUP_DELTA_PA } from './fixtures/inbox'
import { THURSDAY_0710 } from './fixtures/static'
import { createMockApi } from './node'

/**
 * The mock layer follows the API, never the reverse. Every call goes through the MSW handlers and the real client, which
 * parses under the strict generated schemas and throws `schema_mismatch` on any drift. src/api/real.contract.ts holds the
 * same schemas to the real API (`pnpm test:contract`).
 */
const mock = createMockApi({ stepDelayMs: 0 })
beforeAll(() => mock.server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  mock.reset()
  session.set({ userId: 'usr_dana' })
})
afterAll(() => mock.server.close())

const parses = (schema: z.ZodTypeAny, value: unknown) => {
  const out = schema.safeParse(value)
  expect(out.success ? [] : out.error.issues).toEqual([])
}

async function reads() {
  await api.clock()
  await api.agentsStatus()
  await api.system()
  await api.worldPayers()
  await api.strip()
  const inbox = await api.inbox({ state: 'open' })
  await Promise.all(inbox.items.map((i) => api.inboxItem(i.id)))
  const claims = await api.claims({ sort: '-age' }, undefined)
  await Promise.all(claims.items.map((c) => api.claim(c.id)))
  await api.views()
  await api.rules()
  await api.ruleChanges()
  await api.proposals()
  await api.preview({ rule_id: 'rule_t1_delta_pa', mode: 'auto' })
  await api.activity({})
  await api.ledger()
  const eligibility = await api.eligibility({})
  await Promise.all(eligibility.rows.map((r) => api.benefits(r.appointment_id)))
  await api.denials()
  session.set({ userId: 'usr_morgan' })
  await api.cash()
  session.set({ userId: 'usr_dana' })
}

async function advanceToThursday() {
  session.set({ userId: 'usr_morgan' })
  const { advance_id } = await api.advanceClock({ to: THURSDAY_0710 })
  await expect.poll(() => api.advanceStatus(advance_id).then((s) => s.done), { timeout: 5000 }).toBe(true)
  session.set({ userId: 'usr_dana' })
}

describe('the mock serves the API contract', () => {
  it('on every read, at Wed 10:40 and after the overnight', async () => {
    await reads()
    await advanceToThursday()
    await reads()
  })

  it('on every mutation the app sends', async () => {
    const group = await api.approveGroup(GROUP_DELTA_PA)
    await api.approve('itm_4705')
    await api.reject('itm_4733', 'not this one')
    await api.snooze('itm_4851', '2026-10-30T09:00:00-04:00')
    await api.reopen('itm_4851')
    await api.saveView('Denied', { status: ['denied'] })
    await api.correctedClaim('clm_4851', { subscriber_id: '123456789' })
    await api.triage('clm_4744')
    await api.patchRule('rule_t1_status_check', { mode: 'auto' })
    await api.acceptProposal('prop_delta_pa')
    await api.dismissProposal('prop_guardian_5mm')
    session.set({ userId: 'usr_morgan' })
    await api.setPracticeCap(150_000)
    await api.pauseAgents()
    await api.resumeAgents()
    await api.resetClock()
    expect(group.runs).toHaveLength(3)
  })

  it('in the SSE frames a run streams', async () => {
    const { runs } = await api.approveGroup(GROUP_DELTA_PA)
    const runId = runs[0]?.id ?? ''
    await expect.poll(() => api.run(runId).then((d) => d.run.status), { timeout: 5000 }).toBe('succeeded')
    const sub = mock.db.subscribeRun(runId, null, () => undefined)
    sub.unsubscribe()
    const frames: Record<string, z.ZodTypeAny> = { step: S.RunStepEvent, status: S.RunStatusEvent, done: S.RunDoneEvent, counts: S.StripSummary }
    expect(sub.replay.map((f) => f.event)).toContain('done')
    for (const f of sub.replay) parses(frames[f.event] ?? S.ErrorEnvelope, f.data)
  })
})
