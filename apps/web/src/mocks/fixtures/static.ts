/**
 * Fixtures for the read-only screens (Activity, Today's claims, Eligibility, Cash, Denials) and the week of
 * agent decisions that Settings › Agents previews against. Built to the same numbers and rules as the API
 * seed (docs/spec/04-seed.md, apps/api/torch_rcm/seed/canonical/agents.py, torch_rcm/domain/routing.py), so mock
 * mode and the real API tell the same story.
 */
import type {
  CoverageOut,
  ActionKind,
  AgentKind,
  BenefitsPanel,
  CashSummary,
  Deadline,
  DenialMatrix,
  DenialReason,
  DenialReasonColumn,
  EligibilityRow,
  NextAction,
  PayerKey,
  PayerRef,
  PlannedProcedure,
  RootCause,
  SavedView,
  Tier,
} from '../wire'
import { at, FROZEN_NOW, type MockClaim } from './claims'

export const TODAY = FROZEN_NOW.slice(0, 10)
const WEEK = ['2026-10-26', '2026-10-27', TODAY] as const

export const PAYER_REF: Record<PayerKey, PayerRef> = {
  delta_ny: { key: 'delta_ny', name: 'Delta Dental of New York', short_name: 'Delta' },
  metlife: { key: 'metlife', name: 'MetLife Dental', short_name: 'MetLife' },
  cigna: { key: 'cigna', name: 'Cigna Dental', short_name: 'Cigna' },
  aetna: { key: 'aetna', name: 'Aetna Dental', short_name: 'Aetna' },
  guardian: { key: 'guardian', name: 'Guardian Dental', short_name: 'Guardian' },
  ny_medicaid: { key: 'ny_medicaid', name: 'NY Medicaid', short_name: 'NY Medicaid' },
}

/** `iso` + `minutes`, kept in the practice's EDT offset (every mock instant is before the 11/01 DST change). */
export function plusMinutes(iso: string, minutes: number): string {
  const local = new Date(Date.parse(iso) + minutes * 60_000 - 4 * 3_600_000).toISOString().slice(0, 16)
  return `${local}:00-04:00`
}

// ── the week of runs (API: Run rows of the week of Mon 10/26, plus AuditEvents) ───────────────────────
/**
 * One Activity row. `decision` marks the runs that count in "this week's 53" (API readmodels/activity.py
 * `is_decision`: a non-routine action that executed or was proposed, not an approval run). `ran` = ran without
 * review (no inbox item). Human rows are AuditEvents (agent null).
 */
export interface WeekRow {
  run_id: string
  at: string
  agent: AgentKind | null
  actor: string | null
  action_kind: ActionKind | null
  action: string
  subject: string
  claim_id: string | null
  outcome: string
  status: 'succeeded' | 'running' | 'would_have_run'
  decision: boolean
  ran: boolean
  inbox_item_id: string | null
  rule_id: string | null
  tier: Tier | null
  root_cause: RootCause | null
  cents: number
  evidence_kinds: string[]
  audit_line: string
}

const ROUTINE: readonly ActionKind[] = ['status_check', 'payer_rep_call', 'eligibility_check', 'request_835']

type RowIn = Pick<WeekRow, 'run_id' | 'at' | 'agent' | 'action' | 'subject' | 'outcome'> & Partial<WeekRow>

export function weekRow(r: RowIn): WeekRow {
  const action_kind = r.action_kind ?? null
  const inbox_item_id = r.inbox_item_id ?? null
  const status = r.status ?? 'succeeded'
  const human = r.agent === null
  const routine = action_kind !== null && ROUTINE.includes(action_kind)
  const decision = r.decision ?? (!human && status !== 'running' && (!routine || inbox_item_id !== null))
  return {
    actor: null,
    action_kind,
    claim_id: null,
    status,
    decision,
    ran: r.ran ?? (decision && inbox_item_id === null),
    inbox_item_id,
    rule_id: null,
    tier: null,
    root_cause: null,
    cents: 0,
    evidence_kinds: [],
    audit_line: '',
    ...r,
  }
}

const subjectOf = (c: MockClaim) => `#${c.number} · ${c.patient_name}`
const money0 = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`
const payerShort = (k: PayerKey) => PAYER_REF[k].short_name

/** "41 ran without review · 12 came to Dana" — the same 53 as the API seed, run over the mock's own claims. */
export function buildWeek(claims: MockClaim[]): WeekRow[] {
  const by = new Map(claims.map((c) => [c.number, c]))
  const rows: WeekRow[] = []
  const audit = (c: MockClaim, agent: string, label: string, extra: string, rule: string) =>
    `${agent} · ${label} · #${c.number} ${c.patient_name} · ${payerShort(c.payer_key)} · ${money0(c.billed_cents)} · ${extra} · ${rule}`
  const claimRow = (c: MockClaim, r: Omit<RowIn, 'subject'> & Partial<WeekRow>) => {
    rows.push(weekRow({ subject: subjectOf(c), claim_id: c.id, cents: c.billed_cents, ...r }))
  }

  // Claims agent · 13 ran: 9 sends (tier 1), 2 demographic fixes (tier 1), 2 agent-written narratives (tier 2)
  const accepted = claims.filter((c) => c.status === 'accepted').sort((a, b) => a.number - b.number)
  const sends = [4857, 4864, 4860, 4866, 4863, 4855, 4856].flatMap((n) => by.get(n) ?? []).concat(accepted.slice(0, 2))
  for (const c of sends) {
    claimRow(c, {
      run_id: `run_claims_send_${c.number}`,
      at: plusMinutes(c.built_at, 1),
      agent: 'claims',
      action_kind: 'send_claim_pms_codes',
      action: '13 of 13 readiness checks passed; queued for the next file.',
      outcome: c.sent_at ? 'Sent' : 'Queued for file',
      rule_id: 'rule_t1_send_claim',
      tier: 1,
      audit_line: audit(c, 'Claims', 'Send claim · PMS codes', `file ${(c.sent_at ?? c.built_at).slice(11, 16)}`, 'rule Send claim · PMS codes v3 (auto) · until the file leaves'),
    })
  }
  for (const [n, hhmm, fix] of [
    [4860, '09:52', 'subscriber id 8 → 9 digits (PMS)'],
    [4854, '07:02', 'rendering NPI from the PMS provider record'],
  ] as const) {
    const c = by.get(n)
    if (!c) continue
    claimRow(c, {
      run_id: `run_claims_fix_${n}`,
      at: at(TODAY, hhmm),
      agent: 'claims',
      action_kind: 'fix_demographics_resend',
      action: `Fixed ${fix}; resent in the next file.`,
      outcome: 'Resent',
      rule_id: 'rule_t1_fix_demographics',
      tier: 1,
      audit_line: audit(c, 'Claims', 'Fix demographics, resend', fix, 'rule Fix demographics v1 (auto) · until the file leaves'),
    })
  }
  const deltaCrown = accepted.find((c) => c.payer_key === 'delta_ny' && c.procedures_label.startsWith('D27')) ?? accepted[2]
  for (const c of [by.get(4859), deltaCrown].flatMap((x) => x ?? [])) {
    claimRow(c, {
      run_id: `run_claims_text_${c.number}`,
      at: plusMinutes(c.built_at, 1),
      agent: 'claims',
      action_kind: 'send_claim_agent_text',
      action: 'Buildup narrative drafted from the signed note; text guard passed.',
      outcome: c.status === 'ready' ? 'Queued for file' : 'Sent',
      rule_id: 'rule_t2_agent_text_delta_crowns',
      tier: 2,
      audit_line: audit(c, 'Claims', 'Send claim · agent text', 'narrative (text guard ✓)', 'rule Agent text · Delta × crowns v1 (auto, signed Dr. Morgan 09/14)'),
    })
  }

  // Follow-up agent · 18 ran on pending claims: 9 records requests, 6 resubmits, 3 prompt-pay requests (tier 1)
  const skip = new Set([4705, 4796, 4797, 3561, 4800, 4744, 4709, 4731, 4512])
  const pending = claims.filter((c) => c.status === 'pending' && !skip.has(c.number)).sort((a, b) => a.number - b.number)
  const plan: [ActionKind, string, string][] = [
    ...Array.from({ length: 9 }, () => ['records_request', 'rule_t1_records_request', 'Records sent via NEA'] as [ActionKind, string, string]),
    ...Array.from({ length: 6 }, () => ['resubmit_with_attachment', 'rule_t1_records_request', 'Resubmitted with attachment'] as [ActionKind, string, string]),
    ...Array.from({ length: 3 }, () => ['reprocessing_request', 'rule_t1_reprocessing', 'Reprocessing requested'] as [ActionKind, string, string]),
  ]
  plan.forEach(([action, ruleId, outcome], i) => {
    const c = pending[i]
    if (!c) return
    let when = at(WEEK[i % 3] ?? TODAY, `${String(6 + (i % 4)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`)
    if (Date.parse(when) > Date.parse(FROZEN_NOW)) when = at(TODAY, '06:05')
    const nea = `26-44${String(70100 + i * 37).padStart(5, '0')}`
    c.in_flight = `${outcome.toLowerCase()} ${when.slice(5, 7)}/${when.slice(8, 10)} · awaiting reprocessing`
    claimRow(c, {
      run_id: `run_followup_${c.number}_${when.slice(5, 7)}${when.slice(8, 10)}`,
      at: when,
      agent: 'followup',
      action_kind: action,
      action: `${outcome}; NEA# ${nea}.`,
      outcome,
      rule_id: ruleId,
      tier: 1,
      audit_line: audit(c, 'Follow-up', outcome, `NEA# ${nea}`, `rule ${outcome} v1 (auto) · void only`),
    })
  })

  // Eligibility agent · 5 ran: PMS benefit updates from a 271 plan change (tier 2)
  for (const name of ['P. Shah', 'T. Moss', 'E. Ford', 'K. Brandt', 'R. Patel']) {
    rows.push(
      weekRow({
        run_id: `run_elig_update_${name.slice(3).toLowerCase()}`,
        at: at(TODAY, '06:12'),
        agent: 'eligibility',
        action_kind: 'update_pms_benefits',
        action: '271 showed a plan change (used to date); PMS benefits updated.',
        subject: name,
        outcome: 'PMS updated',
        rule_id: 'rule_t2_update_benefits',
        tier: 2,
        audit_line: `Eligibility · Update PMS benefits · ${name} · rule Update PMS benefits v1 (auto, signed Dr. Morgan 06/03)`,
      }),
    )
  }

  // Posting agent · 5 ran: balanced ERAs posted on contract (tier 2)
  for (const [id, when, lines, cents] of [
    ['rem_cigna_1026', at('2026-10-26', '05:53'), 6, 48210],
    ['rem_delta_1026', at('2026-10-26', '06:00'), 26, 412050],
    ['rem_aetna_1026', at('2026-10-26', '06:10'), 6, 61200],
    ['rem_metlife_1027', at('2026-10-27', '06:07'), 12, 133940],
    ['rem_cigna_1028', at(TODAY, '06:40'), 12, 84600],
  ] as const) {
    rows.push(
      weekRow({
        run_id: `run_posting_${id}`,
        at: when,
        agent: 'posting',
        action_kind: 'post_era_line',
        action: `Matched ${lines} lines to contract; balanced.`,
        subject: id,
        outcome: 'Posted',
        rule_id: 'rule_t2_post_era',
        tier: 2,
        cents,
        audit_line: `Posting · Post ERA line · ${id} · $${(cents / 100).toFixed(2)} · rule Post ERA v1 (auto, signed Dr. Morgan 06/11) · until day close`,
      }),
    )
  }

  // 12 came to Dana — one per open Inbox item
  const toDana: [number | null, string, Omit<RowIn, 'subject' | 'run_id' | 'outcome'> & Partial<WeekRow>][] = [
    [4821, 'itm_4821', { at: at(TODAY, '06:15'), agent: 'followup', action_kind: 'resubmit_with_attachment', action: 'Matched the PA of #19 in PMS imaging; rule is Ask → proposed.', rule_id: 'rule_t1_delta_pa', tier: 1, root_cause: 'ours', evidence_kinds: ['era_line', 'ivr_transcript', 'pms_record', 'portal_screenshot', 'rep_call'] }],
    [4836, 'itm_4836', { at: at(TODAY, '06:15'), agent: 'followup', action_kind: 'resubmit_with_attachment', action: 'Matched the PA of #3 in PMS imaging; rule is Ask → proposed.', rule_id: 'rule_t1_delta_pa', tier: 1, root_cause: 'ours', evidence_kinds: ['era_line', 'pms_record', 'portal_screenshot'] }],
    [4840, 'itm_4840', { at: at(TODAY, '06:15'), agent: 'followup', action_kind: 'resubmit_with_attachment', action: 'Matched the PA of #14 in PMS imaging; rule is Ask → proposed.', rule_id: 'rule_t1_delta_pa', tier: 1, root_cause: 'ours', evidence_kinds: ['era_line', 'pms_record', 'portal_screenshot'] }],
    [4733, 'itm_4733', { at: at(TODAY, '06:40'), agent: 'appeals', action_kind: 'reprocessing_request', action: 'Drafted a claim inquiry citing Delta’s own 03/2022 EOB (tooth #31).', tier: 2, root_cause: 'payer', evidence_kinds: ['era_line', 'pms_record', 'prior_eob'] }],
    [4705, 'itm_4705', { at: at(TODAY, '06:30'), agent: 'followup', action_kind: 'reprocessing_request', action: 'Clean claim, day 64, insured plan → prompt-pay reprocessing request.', rule_id: 'rule_t1_reprocessing', tier: 1, root_cause: 'payer', evidence_kinds: ['policy_clause', 'rep_call'] }],
    [4851, 'itm_4851', { at: at(TODAY, '07:02'), agent: 'claims', action_kind: 'fix_demographics_resend', action: 'The new id comes from the 271, not the PMS; the rule only resends PMS values → proposed (84%, under the 90% floor).', rule_id: 'rule_t1_fix_demographics', tier: 1, root_cause: 'patient', evidence_kinds: ['pms_record'] }],
    [4772, 'itm_4772', { at: at(TODAY, '06:20'), agent: 'posting', action_kind: 'post_era_line', action: 'Line does not match tracked benefits (deductible met 05/12) → held, not posted.', rule_id: 'rule_t2_post_era', tier: 2, root_cause: 'payer', evidence_kinds: ['era_line'] }],
    [4748, 'itm_4748', { at: at('2026-10-27', '08:10'), agent: 'posting', action_kind: 'patient_transfer', action: 'Alternate benefit −$38; on the signed estimate → patient transfer proposed.', rule_id: 'rule_t2_patient_transfer', tier: 2, root_cause: 'patient', evidence_kinds: ['era_line'] }],
    [4611, 'itm_4611', { at: at('2026-10-27', '09:12'), agent: 'posting', action_kind: 'write_off', action: 'Max met confirmed on the portal: bill the patient the allowed $1,012; write off the $228 difference (tier 3).', tier: 3, root_cause: 'payer', evidence_kinds: ['portal_screenshot'] }],
    [null, 'itm_elig_chen', { at: at(TODAY, '06:12'), agent: 'eligibility', action: 'Remaining max $180 of $1,500; planned $650 → insurance $180 / patient $470.', evidence_kinds: ['portal_screenshot'], cents: 47000 }],
    [null, 'itm_elig_kim', { at: at(TODAY, '06:12'), agent: 'eligibility', action: 'Bitewings are not covered until 11/03 (last 11/03/2025). Skip D0274 or have the patient sign the acknowledgment.', evidence_kinds: ['portal_screenshot'], cents: 5800 }],
    [null, 'itm_elig_park', { at: at(TODAY, '06:12'), agent: 'eligibility', action: 'MetLife portal and IVR unavailable since 05:40; 271 returned no plan detail.', cents: 63900 }],
  ]
  const eligSubject: Record<string, string> = { itm_elig_chen: 'J. Chen', itm_elig_kim: 'S. Kim', itm_elig_park: 'N. Park' }
  for (const [n, item, r] of toDana) {
    const c = n === null ? undefined : by.get(n)
    rows.push(
      weekRow({
        run_id: `run_dana_${item}`,
        subject: c ? subjectOf(c) : (eligSubject[item] ?? item),
        claim_id: c?.id ?? null,
        cents: c?.billed_cents ?? 0,
        outcome: 'Awaiting you',
        inbox_item_id: item,
        decision: true,
        ran: false,
        ...r,
      }),
    )
  }

  // Routine runs (status checks, rep calls, eligibility checks) — logged, not decisions
  const owens = by.get(4821)
  const brooks = by.get(4705)
  if (owens) {
    claimRow(owens, { run_id: 'run_followup_4821_ivr', at: at('2026-10-27', '16:02'), agent: 'followup', action_kind: 'status_check', action: 'IVR status check: denied 10/26, $0 paid.', outcome: 'No change', tier: 1, evidence_kinds: ['ivr_transcript'], decision: false, audit_line: 'Follow-up · Status check · #4821 K. Owens · IVR · approved by Dana S.' })
    claimRow(owens, { run_id: 'run_followup_4821_rep', at: at('2026-10-27', '16:20'), agent: 'followup', action_kind: 'payer_rep_call', action: 'Rep call ref DD-1027-88412: send PA via NEA, resubmit.', outcome: 'Confirmed', tier: 1, evidence_kinds: ['rep_call'], decision: false, audit_line: 'Follow-up · Payer rep call · #4821 K. Owens · ref DD-1027-88412 · rule Payer rep call v1 (auto)' })
  }
  if (brooks) {
    claimRow(brooks, { run_id: 'run_followup_4705_portal', at: at('2026-10-26', '14:30'), agent: 'followup', action_kind: 'status_check', action: 'Portal status check: still pending (day 63).', outcome: 'No change', tier: 1, evidence_kinds: ['portal_screenshot'], decision: false })
  }
  rows.push(weekRow({ run_id: 'run_elig_running_ito', at: at(TODAY, '10:38'), agent: 'eligibility', action_kind: 'eligibility_check', action: 'Cigna portal slow; retrying.', subject: 'W. Ito', outcome: 'Checking…', status: 'running', tier: 1 }))

  // People (AuditEvents)
  for (const [id, when, actor, action, subject] of [
    ['aud_0001', at('2026-10-26', '10:02'), 'Dana S.', 'Approved rule change: Delta D27xx crowns → attach PA, not BWX', 'rule_t1_send_claim'],
    ['aud_0005', at('2026-10-26', '08:30'), 'Tasha P.', 'Opened J. Chen benefits', 'J. Chen'],
    ['aud_0003', at('2026-10-27', '15:05'), 'Dana S.', 'Approved & sent appeal (from last week)', '#4690'],
    ['aud_0002', at('2026-10-27', '17:05'), 'Dr. Morgan', 'Signed: mechanical refund to the original tender ≤ $100', 'rule_t2_mechanical_refund'],
    ['aud_0004', at(TODAY, '10:12'), 'Dana S.', 'Edited J. Chen front-desk note (not sent yet)', 'J. Chen'],
  ] as const) {
    rows.push(weekRow({ run_id: id, at: when, agent: null, actor, action, subject, outcome: 'Draft', audit_line: action }))
  }
  return rows
}

// ── Eligibility (appointments Thu 10/29 – Fri 10/30) ─────────────────────────────────────────────────
const p = (cdt: string, fee: number, tooth: string | null = null): PlannedProcedure => ({ cdt, tooth, fee_cents: fee * 100 })
const pat = (id: string, name: string, display: string, dob: string) => ({ id, name, display_name: display, dob })

export const ELIGIBILITY: EligibilityRow[] = [
  { appointment_id: 'appt_shah_1029', start: at('2026-10-29', '08:00'), patient: pat('pat_shah_p', 'Priya Shah', 'P. Shah', '1996-02-26'), provider_name: 'Dr. Lee', payer: PAYER_REF.delta_ny, planned: [p('D0120', 57), p('D1110', 85)], planned_fee_cents: 14200, remaining_max_cents: 150000, status: 'verified', note: null, inbox_item_id: null },
  { appointment_id: 'appt_chen_1029', start: at('2026-10-29', '09:00'), patient: pat('pat_chen_j', 'Jia Chen', 'J. Chen', '1979-06-06'), provider_name: 'Dr. Morgan', payer: PAYER_REF.metlife, planned: [p('D4341', 205), p('D4341', 205), p('D2392', 240, '30')], planned_fee_cents: 65000, remaining_max_cents: 18000, status: 'issue', note: 'Planned work exceeds remaining max by $470.', inbox_item_id: 'itm_elig_chen' },
  { appointment_id: 'appt_moss_1029', start: at('2026-10-29', '10:30'), patient: pat('pat_moss_t', 'Tara Moss', 'T. Moss', '1965-01-09'), provider_name: 'Dr. Lee', payer: PAYER_REF.guardian, planned: [p('D0120', 57), p('D1110', 85)], planned_fee_cents: 14200, remaining_max_cents: 150000, status: 'verified', note: null, inbox_item_id: null },
  { appointment_id: 'appt_ito_1029', start: at('2026-10-29', '11:30'), patient: pat('pat_ito_w', 'Wes Ito', 'W. Ito', '1999-05-05'), provider_name: 'Dr. Morgan', payer: PAYER_REF.cigna, planned: [p('D0210', 180), p('D1110', 85)], planned_fee_cents: 26500, remaining_max_cents: 150000, status: 'checking', note: null, inbox_item_id: null },
  { appointment_id: 'appt_kim_1029', start: at('2026-10-29', '13:00'), patient: pat('pat_kim_s', 'Soo Kim', 'S. Kim', '1998-07-14'), provider_name: 'Dr. Lee', payer: PAYER_REF.guardian, planned: [p('D0274', 58), p('D1110', 85)], planned_fee_cents: 14300, remaining_max_cents: 150000, status: 'issue', note: 'D0274 frequency: next eligible 11/03.', inbox_item_id: 'itm_elig_kim' },
  { appointment_id: 'appt_ford_1029', start: at('2026-10-29', '14:30'), patient: pat('pat_ford_e', 'Emma Ford', 'E. Ford', '1991-08-19'), provider_name: 'Dr. Morgan', payer: PAYER_REF.aetna, planned: [p('D2392', 255, '30')], planned_fee_cents: 25500, remaining_max_cents: 150000, status: 'verified', note: null, inbox_item_id: null },
  { appointment_id: 'appt_park_1030', start: at('2026-10-30', '09:00'), patient: pat('pat_park_n', 'Nari Park', 'N. Park', '1988-01-15'), provider_name: 'Dr. Morgan', payer: PAYER_REF.metlife, planned: [p('D0150', 130), p('D0210', 180), p('D4341', 240), p('D0220', 30, '18'), p('D1206', 59)], planned_fee_cents: 63900, remaining_max_cents: 150000, status: 'unverified', note: 'Portal down; unverified.', inbox_item_id: 'itm_elig_park' },
  { appointment_id: 'appt_webb_1030', start: at('2026-10-30', '10:30'), patient: pat('pat_webb_c', 'Cora Webb', 'C. Webb', '1960-12-12'), provider_name: 'Dr. Lee', payer: PAYER_REF.cigna, planned: [p('D0210', 180), p('D1110', 85)], planned_fee_cents: 26500, remaining_max_cents: 150000, status: 'checking', note: null, inbox_item_id: null },
  { appointment_id: 'appt_brandt_1030', start: at('2026-10-30', '13:00'), patient: pat('pat_brandt_k', 'Kurt Brandt', 'K. Brandt', '1962-08-13'), provider_name: 'Dr. Lee', payer: PAYER_REF.delta_ny, planned: [p('D1110', 85)], planned_fee_cents: 8500, remaining_max_cents: 150000, status: 'verified', note: null, inbox_item_id: null },
  { appointment_id: 'appt_patel_1030', start: at('2026-10-30', '13:30'), patient: pat('pat_patel_r', 'Ravi Patel', 'R. Patel', '1972-07-27'), provider_name: 'Dr. Morgan', payer: PAYER_REF.cigna, planned: [p('D4341', 205), p('D4341', 205)], planned_fee_cents: 41000, remaining_max_cents: 150000, status: 'verified', note: null, inbox_item_id: null },
  { appointment_id: 'appt_alvarez_1030', start: at('2026-10-30', '14:30'), patient: pat('pat_alvarez_m', 'Mateo Alvarez', 'M. Alvarez', '1987-03-08'), provider_name: 'Dr. Morgan', payer: PAYER_REF.delta_ny, planned: [p('D0120', 57), p('D1110', 85), p('D0274', 58)], planned_fee_cents: 20000, remaining_max_cents: 150000, status: 'verified', note: null, inbox_item_id: null },
]

const PLAN_NAME: Record<PayerKey, string> = {
  delta_ny: 'Delta Dental PPO',
  metlife: 'MetLife PDP Plus',
  cigna: 'Cigna DPPO',
  aetna: 'Aetna Dental PPO (ASO)',
  guardian: 'Guardian DentalGuard Preferred',
  ny_medicaid: 'NY Medicaid',
}
const FREQ: Record<string, string> = { D4341: '1 / 24 mo', D1110: '2 / yr', D0274: '1 / yr', D0210: '1 / 5 yr', D0120: '2 / yr' }
/** Last-done dates from the PMS history (the mocks' J. Chen card; the API seed has none yet — web-s2.md §3). */
const LAST_DONE: Record<string, Record<string, [string, string | null]>> = {
  appt_chen_1029: { D4341: ['2024-03-12', null], D1110: ['2026-04-14', null], D0274: ['2025-11-03', '2026-11-03'] },
  appt_kim_1029: { D0274: ['2025-11-03', '2026-11-03'], D1110: ['2026-05-02', null] },
}
const EST: Record<string, [number, number] | null> = {
  appt_shah_1029: [8804, 5396],
  appt_chen_1029: [18000, 47000],
  appt_moss_1029: [8804, 5396],
  appt_kim_1029: [8866, 5434],
  appt_ford_1029: [15810, 9690],
  appt_brandt_1030: [5270, 3230],
  appt_patel_1030: [25420, 15580],
  appt_alvarez_1030: [12400, 7600],
}
const AGENT_NOTE: Record<string, string> = {
  appt_chen_1029: 'Remaining max $180 of $1,500; planned $650 → insurance $180 / patient $470 · as of 10/28 · portal. Quote $470 at check-in, or move D2392 after 1/1.',
  appt_kim_1029: 'Bitewings are not covered until 11/03 (last 11/03/2025). Skip D0274 or have the patient sign the non-covered acknowledgment.',
  appt_park_1030: 'MetLife portal and IVR unavailable since 05:40; 271 returned no plan detail. Verify at check-in or call MetLife.',
}

/** A claim's coverage on the plan its payer sells in this seed (the eligibility card's numbers). */
export function coverageFor(c: { coverage_id: string; payer_key: PayerKey; plan_label: string | null }): CoverageOut {
  return {
    id: c.coverage_id,
    payer_key: c.payer_key,
    plan_name: c.plan_label ?? PLAN_NAME[c.payer_key],
    subscriber_id: `6049${c.coverage_id.slice(-5)}`,
    group_no: '0042-10',
    order: 'primary',
    self_funded: c.payer_key === 'aetna',
    annual_max_cents: 150000,
    used_cents: 32000,
    remaining_max_cents: 118000,
    deductible_cents: 5000,
    deductible_met_cents: 5000,
    pct_preventive: 100,
    pct_basic: 80,
    pct_major: 50,
    verified_at: at(TODAY, '06:12'),
    verified_via: 'portal',
  }
}

export function benefitsFor(row: EligibilityRow): BenefitsPanel {
  const payer = row.payer?.key ?? 'delta_ny'
  const used = row.remaining_max_cents === null ? 0 : 150000 - row.remaining_max_cents
  const seen = new Set<string>()
  const history = LAST_DONE[row.appointment_id] ?? {}
  const codes = [...row.planned.map((x) => x.cdt), ...Object.keys(history)].filter((c) => (seen.has(c) ? false : (seen.add(c), true)))
  const est = EST[row.appointment_id] ?? null
  const unverified = row.status === 'unverified'
  return {
    appointment_id: row.appointment_id,
    patient: row.patient,
    coverage: {
      id: `cov_${row.patient.id.slice(4)}_1`,
      payer_key: payer,
      plan_name: PLAN_NAME[payer],
      subscriber_id: row.appointment_id === 'appt_chen_1029' ? '604994417' : `6049${row.patient.dob?.slice(2, 4) ?? '00'}${row.patient.dob?.slice(8, 10) ?? '00'}1`,
      group_no: row.appointment_id === 'appt_chen_1029' ? '0081-22' : '0042-10',
      order: 'primary',
      self_funded: payer === 'aetna',
      annual_max_cents: 150000,
      used_cents: used,
      remaining_max_cents: row.remaining_max_cents ?? 150000,
      deductible_cents: 5000,
      deductible_met_cents: 5000,
      pct_preventive: 100,
      pct_basic: 80,
      pct_major: 50,
      verified_at: unverified ? null : at(TODAY, '06:12'),
      verified_via: unverified ? null : 'portal',
    },
    frequencies: codes.map((cdt) => {
      const [last, okFrom] = history[cdt] ?? [null, null]
      return { cdt, rule: FREQ[cdt] ?? 'no limit', last_done: last, ok_from: okFrom }
    }),
    planned: row.planned,
    planned_fee_cents: row.planned_fee_cents,
    insurance_est_cents: est?.[0] ?? null,
    patient_est_cents: est?.[1] ?? null,
    basis: unverified ? 'unverified · portal and IVR down' : 'as of 10/28 06:12 · portal',
    agent_note: AGENT_NOTE[row.appointment_id] ?? row.note ?? null,
    inbox_item_id: row.inbox_item_id ?? null,
  }
}

// ── Cash (owner) — the API's KPI set at Wed 10:40, every value with its formula and basis ───────────────
export const CASH: Omit<CashSummary, 'agent_impact'> = {
  kpis: [
    { key: 'days_in_ar', label: 'Days in A/R', value: 27, unit: 'days', formula: '(insurance A/R + patient A/R) ÷ average daily net production (90 d)', basis: '($75,500 + $33,100) ÷ $4,020/day' },
    { key: 'insurance_ar', label: 'Insurance A/R', value: 7550000, unit: 'cents', formula: 'Σ billed of claims sent and not paid', basis: '101 claims' },
    { key: 'patient_ar', label: 'Patient A/R', value: 3310000, unit: 'cents', formula: 'Σ positive patient balances, aged from DOS', basis: 'credits $2,180.00 shown separately' },
    { key: 'avg_daily_net_production', label: 'Avg daily net production', value: 402000, unit: 'cents', formula: 'net production (90 d) ÷ 90', basis: '$361,800 over 90 days' },
    { key: 'gross_production_month', label: 'Gross production · Oct', value: 11260000, unit: 'cents', formula: 'Σ fees of procedures by DOS this month', basis: 'practice fee schedule' },
    { key: 'contractual_month', label: 'Contractual write-offs · Oct', value: 2140000, unit: 'cents', formula: 'Σ (fee − contract allowed) by DOS', basis: 'plan contract schedules' },
    { key: 'net_production_month', label: 'Net production · Oct', value: 9120000, unit: 'cents', formula: 'gross − contractual', basis: 'by DOS' },
    { key: 'insurance_collections_month', label: 'Insurance paid · Oct', value: 6130000, unit: 'cents', formula: 'Σ paid on 835s received this month', basis: '118 claims paid' },
    { key: 'patient_collections_month', label: 'Patient collections · Oct', value: 2564000, unit: 'cents', formula: 'Σ patient payments this month', basis: 'checkout + statements' },
    { key: 'collections_month', label: 'Collections · Oct', value: 8694000, unit: 'cents', formula: 'insurance paid + patient collections', basis: 'cash basis' },
    { key: 'net_collection_rate', label: 'Net collection rate (90 d)', value: 93.2, unit: 'pct', formula: 'collections ÷ (production − contractual adjustments), 90 d', basis: 'cash vs. net production; lags payer latency' },
    { key: 'non_contractual_month', label: 'Non-contractual write-offs · Oct', value: 87600, unit: 'cents', formula: 'tier-3 write-offs + small-balance adjustments', basis: 'signed by Dr. Morgan' },
  ],
  aging: [
    { bucket: '0_30', cents: 4642000, count: 69, pct: 61.5 },
    { bucket: '31_60', cents: 1589000, count: 16, pct: 21.0 },
    { bucket: '61_90', cents: 707400, count: 9, pct: 9.4 },
    { bucket: '90_plus', cents: 611600, count: 7, pct: 8.1 },
  ],
  by_payer: [
    { key: 'delta_ny', label: 'Delta', cents: 2894000, count: 30 },
    { key: 'metlife', label: 'MetLife', cents: 1621000, count: 22 },
    { key: 'cigna', label: 'Cigna', cents: 1248000, count: 32 },
    { key: 'aetna', label: 'Aetna', cents: 1037000, count: 9 },
    { key: 'guardian', label: 'Guardian', cents: 750000, count: 8 },
  ],
  by_provider: [
    { key: 'prv_morgan', label: 'Dr. Morgan', cents: 3862500, count: 43 },
    { key: 'prv_lee', label: 'Dr. Lee', cents: 3320200, count: 41 },
    { key: 'prv_cole', label: 'RDH M. Cole', cents: 280700, count: 12 },
    { key: 'prv_baptiste', label: 'RDH J. Baptiste', cents: 86600, count: 5 },
  ],
  writeoffs_by_type: [
    { key: 'medical necessity', label: 'medical necessity', cents: 31000, count: 1 },
    { key: 'small patient balance', label: 'small patient balance', cents: 25600, count: 1 },
    { key: 'timely filing', label: 'timely filing', cents: 31000, count: 1 },
  ],
  patient_aging: [
    { bucket: '0_30', cents: 1771318, count: 14, pct: 53.5 },
    { bucket: '31_60', cents: 1006417, count: 16, pct: 30.4 },
    { bucket: '61_90', cents: 502407, count: 8, pct: 15.2 },
    { bucket: '90_plus', cents: 29858, count: 2, pct: 0.9 },
  ],
  appeals_12mo: { won: 6, total: 9, reconsideration_won: 5, reconsideration_total: 6, formal_won: 1, formal_total: 3 },
}

// ── Denials routing (port of apps/api/torch_rcm/domain/routing.py) ─────────────────────────────────────────
export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  reconsideration: 'Reconsideration · resend or inquiry, no signature',
  corrected: 'Corrected claim / COB resubmit',
  formal_appeal: 'Formal appeal · the rendering dentist signs',
  bill_patient_link: 'Bill patient · closes in Payments',
  write_off: 'Write-off · Dr. Morgan',
}
export const NEXT_ACTION_ORDER: readonly NextAction[] = ['reconsideration', 'corrected', 'formal_appeal', 'bill_patient_link', 'write_off']

export interface Route {
  next_action: NextAction
  agent: AgentKind
  signer_role: 'rendering_dentist' | 'owner' | null
  checklist: string[]
}

export function routeDenial(carc: string, rarc: string | null | undefined, payer: PayerKey, selfFunded: boolean): Route {
  if (carc === 'CO-16' || carc === 'CO-119') return { next_action: 'reconsideration', agent: 'followup', signer_role: null, checklist: [] }
  if (carc === 'CO-22') return { next_action: 'corrected', agent: 'followup', signer_role: null, checklist: [] }
  if (['CO-50', 'CO-29', 'CO-197'].includes(carc)) {
    let checklist = ['rendering dentist signs the attestation']
    if (selfFunded) checklist.push('patient authorization required (ERISA)')
    if (carc === 'CO-29') checklist = ['proof of timely receipt (payer 277CA)', ...checklist]
    return { next_action: 'formal_appeal', agent: 'appeals', signer_role: 'rendering_dentist', checklist }
  }
  if (['PR-119', 'PR-204'].includes(carc) && payer !== 'ny_medicaid') {
    return { next_action: 'bill_patient_link', agent: 'posting', signer_role: 'owner', checklist: ['write off the contractual difference (tier 3)'] }
  }
  if (carc === 'CO-204' || payer === 'ny_medicaid') return { next_action: 'write_off', agent: 'posting', signer_role: 'owner', checklist: [] }
  void rarc
  return { next_action: 'reconsideration', agent: 'followup', signer_role: null, checklist: [] }
}

/** CO = contractual obligation: the practice cannot bill the patient if the appeal is lost; PR can be. */
export const patientBillableIfLost = (carc: string, payer: PayerKey) => carc.startsWith('PR') && payer !== 'ny_medicaid'

/** Payer × reason columns, as the API's `screens.DENIAL_REASONS`. Plan limits (PR-*) get no column. */
const DENIAL_REASONS: readonly DenialReasonColumn[] = [
  { key: 'doc', label: 'Doc' },
  { key: 'freq', label: 'Freq' },
  { key: 'cob', label: 'COB' },
  { key: 'tf', label: 'TF' },
  { key: 'med_nec', label: 'Med. nec.' },
  { key: 'other', label: 'Other' },
]
const CARC_REASON: Record<string, DenialReason> = { 'CO-16': 'doc', 'CO-119': 'freq', 'CO-22': 'cob', 'CO-29': 'tf', 'CO-50': 'med_nec' }

/** GET /denials `matrix`: the worklist rows by payer × reason, as the API's `screens.denial_matrix`. */
export function denialMatrix(rows: readonly { carc: string; claim: { payer: PayerRef } }[]): DenialMatrix {
  const keys = DENIAL_REASONS.map((c) => c.key)
  const byPayer = new Map<PayerKey, { payer: PayerRef; counts: Map<DenialReason, number> }>()
  const totals = new Map<DenialReason, number>()
  let excluded = 0
  for (const r of rows) {
    if (r.carc.startsWith('PR-')) {
      excluded++
      continue
    }
    const reason = CARC_REASON[r.carc] ?? 'other'
    const p = byPayer.get(r.claim.payer.key) ?? { payer: r.claim.payer, counts: new Map() }
    p.counts.set(reason, (p.counts.get(reason) ?? 0) + 1)
    byPayer.set(r.claim.payer.key, p)
    totals.set(reason, (totals.get(reason) ?? 0) + 1)
  }
  const payers = [...byPayer.values()].map(({ payer, counts }) => {
    const cells = keys.map((k) => ({ reason: k, count: counts.get(k) ?? 0 }))
    return { payer, cells, total: cells.reduce((a, c) => a + c.count, 0) }
  })
  payers.sort((a, b) => b.total - a.total || (a.payer.short_name < b.payer.short_name ? -1 : a.payer.short_name > b.payer.short_name ? 1 : 0))
  const totalCells = keys.map((k) => ({ reason: k, count: totals.get(k) ?? 0 }))
  return { columns: [...DENIAL_REASONS], payers, totals: totalCells, total: totalCells.reduce((a, c) => a + c.count, 0), excluded }
}

/** Self-funded (ERISA) plans among the pinned claims' coverages. */
export const SELF_FUNDED_CLAIMS = new Set(['clm_4796', 'clm_4797', 'clm_4800'])

// ── Demo step 8: what the scheduler does between Wed 10:40 and Thu 07:10 ───────────────────────────────
export const THURSDAY_0710 = '2026-10-29T07:10:00-04:00'

export interface OvernightDenial {
  number: number
  carc: string
  rarc: string | null
  decoded: string
  root_cause: RootCause
  deadline: Deadline
  /** The Inbox item the agent leaves for a person. */
  item: { agent: AgentKind; tier: Tier; title: string; recommendation: string; summary: string; action: ActionKind; rule_id: string | null; required_role?: 'owner' | 'dentist' }
}

export const OVERNIGHT_DENIALS: OvernightDenial[] = [
  {
    number: 4796,
    carc: 'CO-50',
    rarc: 'N10',
    decoded: 'Not deemed medically necessary after consultant review',
    root_cause: 'payer',
    deadline: { kind: 'appeal', due_on: '2027-04-27', basis: 'Guardian ERISA: 180 days from the 10/29 835' },
    item: { agent: 'appeals', tier: 3, title: '#4796 · L. Ito · Guardian · CO-50 · N10 formal appeal', recommendation: 'Formal appeal (level 1 of 2) with the 10/09 perio chart and FMX. Dr. Lee signs; the patient must authorize (self-funded ERISA plan).', summary: 'Consultant review denied D4341 UR + UL as not medically necessary. The chart shows ≥ 5 mm pockets in UR.', action: 'formal_appeal', rule_id: 'rule_t3_formal_appeal', required_role: 'dentist' },
  },
  {
    number: 4797,
    carc: 'CO-16',
    rarc: 'M127',
    decoded: 'Records requested: send the chart and radiographs',
    root_cause: 'ours', // the Claims agent sent the FMX where Guardian's rule names the perio chart, so the records rule may not run it
    deadline: { kind: 'none', due_on: null, basis: 'records request · no payer deadline' },
    item: { agent: 'followup', tier: 1, title: '#4797 · A. Castillo · Guardian · records request', recommendation: 'Send the 10/09 perio chart and FMX via NEA and reference the claim number.', summary: 'Guardian’s 835 asks for records (M127). Our Claims agent sent the FMX where Guardian’s rule names the perio chart, so root cause is ours and the records request is held for Dana.', action: 'records_request', rule_id: 'rule_t1_records_request' },
  },
  {
    number: 4800,
    carc: 'CO-22',
    rarc: null,
    decoded: 'Care may be covered by another payer (coordination of benefits)',
    root_cause: 'payer',
    deadline: { kind: 'timely_filing', due_on: '2027-10-13', basis: 'MetLife: 12 months from DOS 10/13 · new primary claim' },
    item: { agent: 'followup', tier: 2, title: '#4800 · S. Moreno · Aetna · COB (CO-22)', recommendation: 'Change the coverage order in the PMS so the MetLife plan on file (listed secondary) is primary, then send a new primary claim to MetLife.', summary: 'Aetna says another plan is primary. Changing the PMS coverage order is tier 2 and no signed rule covers it → Dana.', action: 'cob_order_change', rule_id: null },
  },
  {
    number: 3561,
    carc: 'CO-29',
    rarc: null,
    decoded: 'The time limit for filing has expired',
    root_cause: 'payer',
    deadline: { kind: 'appeal', due_on: '2027-04-27', basis: 'MetLife: 180 days from the 10/29 835' },
    item: { agent: 'appeals', tier: 3, title: '#3561 · G. Morris · MetLife · timely filing (CO-29)', recommendation: 'Timely-filing appeal with MetLife’s own 11/04/2025 277CA as proof of receipt. If upheld: non-contractual write-off, the patient cannot be billed.', summary: 'MetLife has no record of the 11/2025 submission; our 277CA from 11/04/2025 shows they received it.', action: 'formal_appeal', rule_id: 'rule_t3_formal_appeal', required_role: 'owner' },
  },
]

export const VIEWS: SavedView[] = [
  { id: 'view_pending_30', name: 'Pending 31–60 d', search_params: { status: ['pending'], age: '31_60', sort: '-age' }, owner_user_id: 'usr_dana', created_at: at('2026-10-26', '09:00'), builtin: false },
]
