/**
 * The web's schemas against what the real API sent (`pnpm test:contract`, see scripts/contract-real.mjs). wire.test.ts
 * holds the mock to the same schemas; this file is what makes "green against the API" a check rather than a claim.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { reduceRunMessage, runViewOf } from '@/lib/runEvents'
import type { RunView } from './schema'
import * as S from './schema'

interface HttpRecord {
  method: string
  path: string
  schema: string
  status: number
  body: unknown
}
interface EvidenceRecord {
  kind: 'timeline_evidence'
  entry: string
  wanted: string[]
  held: string[]
}
interface Frame {
  event: string
  data: unknown
}

const load = <T,>(file: string) => JSON.parse(readFileSync(join(process.env.CONTRACT_DUMP ?? '', file), 'utf8')) as T
const records = load<(HttpRecord | EvidenceRecord)[]>('http.json')
const http = records.filter((r): r is HttpRecord => !('kind' in r))
const { run_id: runId, frames: runFrames } = load<{ run_id: string; frames: Frame[] }>('run_frames.json')
const firehose = load<Frame[]>('firehose.json')

const named = S as unknown as Record<string, z.ZodTypeAny>
const schemaOf = (name: string) => (name === 'WorldPayers' ? z.array(S.WorldPayer) : named[name])
const parses = (schema: z.ZodTypeAny | undefined, value: unknown) => {
  expect(schema, 'no schema of that name').toBeDefined()
  const out = schema?.safeParse(value)
  expect(out?.success ? [] : out?.error.issues).toEqual([])
}
const cash = (i: number) => {
  const all = http.filter((r) => r.schema === 'CashSummary').map((r) => S.CashSummary.parse(r.body))
  const kpi = (key: string) => all[i]?.kpis.find((k) => k.key === key)?.value ?? NaN
  return { days: kpi('days_in_ar'), ar: kpi('insurance_ar') + kpi('patient_ar'), daily: kpi('avg_daily_net_production') }
}

describe('the real API', () => {
  it('answers every call as expected', () => {
    const wrong = http.filter((r) => r.status >= (r.schema === 'ErrorEnvelope' ? 500 : 400)).map((r) => `${r.method} ${r.path} ${r.status}`)
    expect(wrong).toEqual([])
    expect(http.length).toBeGreaterThan(500)
  })

  it.each([...new Set(http.map((r) => r.schema))])('sends %s as the web parses it', (name) => {
    for (const r of http.filter((x) => x.schema === name)) parses(schemaOf(name), r.body)
  })

  it('streams run frames the reducer folds to a finished view', () => {
    const snapshot = http.find((r) => r.path === `/runs/${runId}`)
    const start = runViewOf(S.RunDetail.parse(snapshot?.body))
    let run: RunView | undefined = { ...start, status: 'queued', evidence: [], last_event_id: null, audit_line: '', steps: start.steps.map((s) => ({ ...s, status: 'pending', evidence_ids: [] })) }
    let result = 'continue'
    for (const [i, f] of runFrames.entries()) {
      const fx = reduceRunMessage(run, { id: i + 1, event: f.event, data: JSON.stringify(f.data) })
      run = fx.run
      result = fx.result
    }
    expect(result).toBe('done')
    expect(run?.status).toBe('succeeded')
    expect(run?.steps.every((s) => s.status === 'ok' || s.status === 'skipped')).toBe(true)
    expect(run?.audit_line).not.toBe('')
    expect(run?.evidence.length).toBeGreaterThan(0)
  })

  it('sends firehose frames the app acts on, and a `done` that ends the advance', () => {
    const schemas: Record<string, z.ZodTypeAny> = { status: S.FirehoseStatusEvent, agents: S.FirehoseAgentsEvent, advance: S.AdvanceSnapshot }
    for (const f of firehose) parses(schemas[f.event], f.data)
    const advances = firehose.filter((f) => f.event === 'advance').map((f) => S.AdvanceSnapshot.parse(f.data))
    expect(advances.at(-1)?.done).toBe(true)
  })

  it('holds on the run every evidence id the claim timeline names', () => {
    const missing = records.filter((r): r is EvidenceRecord => 'kind' in r).flatMap((r) => r.wanted.filter((id) => !r.held.includes(id)).map((id) => `${r.entry}: ${id}`))
    expect(missing).toEqual([])
  })

  it('computes days in A/R from its own formula on both days of the demo', () => {
    const [wed, thu] = [cash(0), cash(1)]
    expect(wed.days).toBe(27)
    expect(wed.days).toBe(Math.round(wed.ar / wed.daily))
    expect(thu.days).toBe(26) // what e2e step 10 asserts: six paid overnight, and the 90-day window moved
    expect(thu.days).toBe(Math.round(thu.ar / thu.daily))
  })
})
