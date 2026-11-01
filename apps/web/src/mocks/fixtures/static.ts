/**
 * Read-only fixtures for the static screens (Activity, Today's claims, Eligibility, Cash, Denials,
 * Settings). Numbers are the reconciled ones from docs/spec/04-seed.md.
 */
import { z } from 'zod'
import type { ActivityRow, AgentKind, Ledger, Rule, RuleChange, RuleProposal, SavedView } from '@/api/schema'
import type { CashSummary, DenialGroup, EligibilityRow } from '@/api/schema'
import { at } from './claims'

type Eligibility = z.infer<typeof EligibilityRow>
type Cash = z.infer<typeof CashSummary>
type Denials = z.infer<typeof DenialGroup>

/** "This week agents ran 41 items without you" — by agent: eligibility 5, claims 13, followup 18, posting 5. */
export function buildActivity(): ActivityRow[] {
  const plan: [AgentKind, number, string][] = [
    ['eligibility', 5, 'Eligibility verified'],
    ['claims', 13, 'Claim sent with PMS codes'],
    ['followup', 18, 'Status check'],
    ['posting', 5, 'ERA line posted on contract'],
  ]
  const rows: ActivityRow[] = []
  let i = 0
  for (const [agent, n, action] of plan) {
    for (let k = 0; k < n; k++) {
      const day = 26 + (i % 3)
      const hh = String(6 + (i % 5)).padStart(2, '0')
      const mm = String((i * 7) % 60).padStart(2, '0')
      rows.push({
        id: `act_${i}`,
        at: at(`2026-10-${day}`, `${hh}:${mm}`),
        agent,
        action,
        subject: `#${4600 + i * 3}`,
        outcome: agent === 'followup' ? 'in process · ref # on file' : 'done',
        status: 'succeeded',
        claim_id: null,
        evidence_count: agent === 'followup' ? 1 : 0,
      })
      i++
    }
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at))
}

export const LEDGER: Ledger = {
  sent: [
    { claim_id: 'clm_4856', number: 4856, patient_name: 'R. Ortega', payer_key: 'cigna', billed_cents: 49000, label: 'D4341 LR sent · UR not billable (no depths charted)' },
    { claim_id: 'clm_4857', number: 4857, patient_name: 'P. Brennan', payer_key: 'aetna', billed_cents: 25500, label: 'D2392 sent as-is · alt benefit expected · pt est $71.60' },
    { claim_id: 'clm_4855', number: 4855, patient_name: 'O. Novak', payer_key: 'delta_ny', billed_cents: 91500, label: 'D3320 #13 · 999 accepted' },
  ],
  leaving_next_file: [
    { claim_id: 'clm_4859', number: 4859, patient_name: 'K. Owens', payer_key: 'delta_ny', billed_cents: 124000, label: 'D2740 #30 +2 · 12 of 12 checks', file_time: '10:45', editable_until: '10:44' },
    { claim_id: 'clm_4858', number: 4858, patient_name: 'A. Reyes', payer_key: 'guardian', billed_cents: 118000, label: 'Molar crown · Guardian alt-benefit possible', file_time: '11:15', editable_until: '11:14' },
  ],
  held: [
    { claim_id: 'clm_4852', number: 4852, patient_name: 'B. Akers', payer_key: 'metlife', billed_cents: 21000, label: 'Secondary', reason: 'Waiting for the Delta 835 (primary)', held_since: at('2026-10-27', '15:00'), timely_due: '2027-10-27', owner: 'Claims agent' },
  ],
  not_billable: [],
}

export const ELIGIBILITY: Eligibility[] = [
  { appointment_id: 'appt_chen_1029', start: at('2026-10-29', '09:00'), patient_name: 'J. Chen', provider_name: 'Dr. Morgan', payer_key: 'delta_ny', planned_label: 'D4341×2 $410 + D2392 #30 $240', max_left_cents: 18000, eligibility_status: 'issue', basis: 'portal · 10/28 6:12 AM' },
  { appointment_id: 'appt_ito_1029', start: at('2026-10-29', '09:30'), patient_name: 'W. Ito', provider_name: 'RDH M. Cole', payer_key: 'guardian', planned_label: 'D1110, D0120', max_left_cents: 120000, eligibility_status: 'verified', basis: '271 · 10/28 6:12 AM' },
  { appointment_id: 'appt_kim_1029', start: at('2026-10-29', '11:00'), patient_name: 'S. Kim', provider_name: 'Dr. Lee', payer_key: 'metlife', planned_label: 'D2740 #19', max_left_cents: null, eligibility_status: 'issue', basis: '271 · terminated 09/30' },
  { appointment_id: 'appt_ford_1029', start: at('2026-10-29', '13:00'), patient_name: 'E. Ford', provider_name: 'Dr. Morgan', payer_key: 'cigna', planned_label: 'D0150, D0210', max_left_cents: 150000, eligibility_status: 'verified', basis: 'portal · 10/28 6:13 AM' },
  { appointment_id: 'appt_park_1029', start: at('2026-10-29', '14:30'), patient_name: 'N. Park', provider_name: 'RDH M. Cole', payer_key: 'guardian', planned_label: 'D4910', max_left_cents: 90000, eligibility_status: 'issue', basis: 'IVR only · portal down' },
  { appointment_id: 'appt_webb_1030', start: at('2026-10-30', '09:00'), patient_name: 'C. Webb', provider_name: 'Dr. Lee', payer_key: 'delta_ny', planned_label: 'D0120, D1110', max_left_cents: 104000, eligibility_status: 'verified', basis: 'portal · 10/28 6:15 AM' },
  { appointment_id: 'appt_alvarez_1030', start: at('2026-10-30', '10:30'), patient_name: 'M. Alvarez', provider_name: 'Dr. Morgan', payer_key: 'delta_ny', planned_label: 'D2392 #4', max_left_cents: 132000, eligibility_status: 'verified', basis: 'portal · 10/28 6:15 AM' },
  { appointment_id: 'appt_patel_1030', start: at('2026-10-30', '13:30'), patient_name: 'R. Patel', provider_name: 'RDH M. Cole', payer_key: 'aetna', planned_label: 'D1110, D0274', max_left_cents: 141000, eligibility_status: 'verified', basis: '271 · 10/28 6:16 AM' },
]

export const CASH: Cash = {
  kpis: {
    days_in_ar: { value: 27, formula: '($75,500 insurance A/R + $33,100 patient A/R) ÷ $4,020 avg daily net production', basis: '90 d' },
    net_collection_rate: { value: '95.3%', formula: '$86,940 collections ÷ ($112,600 production − $21,400 contractual)', basis: 'Oct to date' },
    insurance_ar: { value: '$75,500', formula: '101 claims sent and not closed', basis: 'as of 10/28 10:40' },
    patient_ar: { value: '$33,100', formula: 'patient balances aged from DOS · credits $2,180', basis: 'as of 10/28 10:40' },
  },
  aging: [
    { bucket: '0–30', cents: 4642000 },
    { bucket: '31–60', cents: 1589000 },
    { bucket: '61–90', cents: 707400 },
    { bucket: '90+', cents: 611600 },
  ],
  by_payer: [
    { payer_key: 'delta_ny', cents: 2894000 },
    { payer_key: 'metlife', cents: 1621000 },
    { payer_key: 'cigna', cents: 1248000 },
    { payer_key: 'aetna', cents: 1037000 },
    { payer_key: 'guardian', cents: 750000 },
  ],
}

export function buildDenials(rows: { id: string; number: number; patient_name: string; payer_key: Denials['items'][number]['payer_key']; billed_cents: number }[]): Denials[] {
  const pick = (n: number) => rows.find((r) => r.number === n)
  const item = (n: number, next_step: string) => {
    const r = pick(n)
    return r ? [{ ...r, patient_id: `pat_${n}`, status: 'denied' as const, needs_action: true, dos: '2026-10-12', denial: null, next_step }] : []
  }
  return [
    { next_action: 'reconsideration', items: [...item(4821, 'records via NEA · group of 3'), ...item(4836, 'records via NEA · group of 3'), ...item(4840, 'records via NEA · group of 3'), ...item(4733, 'claim inquiry with 03/2022 EOB')] },
    { next_action: 'bill_patient_link', items: item(4611, 'bill patient allowed $1,012 · closes in Payments') },
  ]
}

const rule = (r: Partial<Rule> & Pick<Rule, 'id' | 'tier' | 'action' | 'mode' | 'label'>): Rule => ({
  scope: { item_type: r.action, payer_key: null, max_cents: null },
  confidence_floor: null,
  outcome_metric: r.tier === 1 ? 'paid_30d' : 'balanced',
  reverses_in: r.tier === 3 ? 'none' : 'until_file_leaves',
  requires_owner_signoff: r.tier !== 1,
  signed_by: null,
  signed_at: null,
  changed_by: 'usr_morgan',
  changed_at: at('2026-10-14', '09:00'),
  ran_without_review_7d: 0,
  base_rate: { n: 0, k: 0 },
  version: 1,
  origin: 'authored',
  ...r,
})

/** 19 rows: 9 + 7 + 3 (docs/spec/04-seed.md "Rules"). */
export const RULES: Rule[] = [
  rule({ id: 'rule_t1_status_check', tier: 1, action: 'status_check', mode: 'ask', label: 'Status check', ran_without_review_7d: 18, base_rate: { n: 142, k: 139 } }),
  rule({ id: 'rule_t1_records', tier: 1, action: 'records_request', mode: 'ask', label: 'Records request → NEA', base_rate: { n: 9, k: 8 } }),
  rule({ id: 'rule_t1_delta_pa', tier: 1, action: 'resubmit_with_attachment', mode: 'ask', label: 'Resubmit with attachment · Delta · missing PA', scope: { payer_key: 'delta_ny', item_type: 'missing_pa', max_cents: 200000 }, base_rate: { n: 25, k: 23 } }),
  rule({ id: 'rule_t1_reprocessing', tier: 1, action: 'reprocessing_request', mode: 'ask', label: 'Reprocessing request', base_rate: { n: 8, k: 7 } }),
  rule({ id: 'rule_t1_835', tier: 1, action: 'request_835', mode: 'auto', label: 'Request 835', ran_without_review_7d: 2, base_rate: { n: 6, k: 6 } }),
  rule({ id: 'rule_t1_send', tier: 1, action: 'send_claim_pms_codes', mode: 'auto', label: 'Send claim · PMS codes', ran_without_review_7d: 13, outcome_metric: 'accepted', base_rate: { n: 31, k: 30 } }),
  rule({ id: 'rule_t1_demographics', tier: 1, action: 'fix_demographics_resend', mode: 'ask', label: 'Fix demographics, resend', base_rate: { n: 25, k: 21 } }),
  rule({ id: 'rule_t1_eligibility', tier: 1, action: 'eligibility_check', mode: 'auto', label: 'Eligibility check', ran_without_review_7d: 5, outcome_metric: 'none', base_rate: { n: 60, k: 57 } }),
  rule({ id: 'rule_t1_rep_call', tier: 1, action: 'payer_rep_call', mode: 'auto', label: 'Payer rep call (bounded)', ran_without_review_7d: 3, outcome_metric: 'none', base_rate: { n: 9, k: 9 } }),
  rule({ id: 'rule_t2_post_era', tier: 2, action: 'post_era_line', mode: 'ask', label: 'Post ERA line · balanced & patient resp matches', ran_without_review_7d: 0 }),
  rule({ id: 'rule_t2_benefits', tier: 2, action: 'update_pms_benefits', mode: 'ask', label: 'Update PMS benefits' }),
  rule({ id: 'rule_t2_agent_text', tier: 2, action: 'send_claim_agent_text', mode: 'auto', label: 'Agent text · Delta × crowns', signed_by: 'usr_morgan', signed_at: at('2026-09-14', '09:00') }),
  rule({ id: 'rule_t2_corrected', tier: 2, action: 'corrected_claim', mode: 'ask', label: 'Corrected claim (freq. 7)' }),
  rule({ id: 'rule_t2_transfer', tier: 2, action: 'patient_transfer', mode: 'ask', label: 'Patient-responsibility transfer' }),
  rule({ id: 'rule_t2_statement', tier: 2, action: 'send_statement', mode: 'ask', label: 'Send statement' }),
  rule({ id: 'rule_t2_refund', tier: 2, action: 'mechanical_refund', mode: 'auto', label: 'Mechanical refund to original tender ≤ $100', signed_by: 'usr_morgan', signed_at: at('2026-10-27', '17:00') }),
  rule({ id: 'rule_t3_writeoff', tier: 3, action: 'write_off', mode: 'human_only', label: 'Write-off / void', outcome_metric: 'none', reverses_in: 'none' }),
  rule({ id: 'rule_t3_appeal', tier: 3, action: 'formal_appeal', mode: 'human_only', label: 'Formal appeal', outcome_metric: 'none', reverses_in: 'none' }),
  rule({ id: 'rule_t3_discretionary', tier: 3, action: 'discretionary_refund', mode: 'human_only', label: 'Discretionary refund / waiver / collections', outcome_metric: 'none', reverses_in: 'none' }),
]

export const RULE_CHANGES: RuleChange[] = [
  { id: 'rc_5', rule_id: 'rule_t2_refund', at: at('2026-10-27', '17:00'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto', signed_by: 'usr_morgan' }, items_affected_since: 1 },
  { id: 'rc_4', rule_id: 'rule_t1_delta_pa', at: at('2026-10-26', '10:02'), by: 'usr_dana', before: { attach: 'bwx' }, after: { attach: 'pa' }, items_affected_since: 3 },
  { id: 'rc_3', rule_id: 'rule_t1_835', at: at('2026-10-21', '09:00'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto' }, items_affected_since: 2 },
  { id: 'rc_2', rule_id: 'rule_t1_send', at: at('2026-10-14', '09:00'), by: 'system', before: { mode: 'observe' }, after: { mode: 'auto' }, items_affected_since: 31 },
  { id: 'rc_1', rule_id: 'rule_t2_agent_text', at: at('2026-09-14', '09:00'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto', signed_by: 'usr_morgan' }, items_affected_since: 4 },
]

export const PROPOSALS: RuleProposal[] = [
  { id: 'prop_delta_pa', title: 'Delta missing-PA resubmits < $2,000', rule_draft: { action: 'resubmit_with_attachment', mode: 'auto', max_cents: 200000 }, evidence: { approved: 25, total: 25, outcome_k: 23, outcome_n: 25 }, root_cause_guard: false, state: 'open' },
  { id: 'prop_delta_pa_ours', title: 'Delta missing-PA resubmits (root cause: ours)', rule_draft: { action: 'resubmit_with_attachment', mode: 'auto' }, evidence: { approved: 3, total: 3, outcome_k: 0, outcome_n: 0 }, root_cause_guard: true, guard_reason: 'Root cause is ours: fix the upstream attachment rule instead. This can never be learned into auto-run.', state: 'open' },
  { id: 'prop_guardian_5mm', title: 'Guardian ≥ 5 mm perio narratives · watching · n = 1', rule_draft: { action: 'send_claim_agent_text' }, evidence: { approved: 1, total: 1, outcome_k: 1, outcome_n: 1 }, root_cause_guard: false, state: 'open' },
]

export const VIEWS: SavedView[] = [
  { id: 'view_pending_30', name: 'Pending 31–60 d', search_params: { status: ['pending'], age: '31_60', sort: '-age' }, owner_user_id: 'usr_dana', builtin: false },
]
