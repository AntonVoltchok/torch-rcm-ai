/**
 * Settings › Agents fixture: the 19 rules, the 5-row change log and the 3 proposals exactly as the API seed
 * builds them (apps/api/torch/seed/canonical/agents.py), so mock mode and the real API show the same table.
 */
import type { Rule, RuleChange, RuleProposal, Tier } from '@/api/schema'
import { at } from './claims'

export const PRACTICE_CAP_CENTS = 100_000

/** Tier headers, verbatim from the API (torch/api/services/rules.py TIER_TEXT). */
export const TIER_TEXT: Record<Tier, { label: string; description: string }> = {
  1: {
    label: 'Talks to payers',
    description: 'Agent, without review, from PMS data and documents; or asks Dana. Can learn to run without review where an outcome metric exists.',
  },
  2: {
    label: 'Touches the ledger or patients',
    description: 'Agent, under a rule Dr. Morgan signed · $1,000 practice cap. Includes any payer- or patient-facing text the agent wrote.',
  },
  3: { label: 'Commits the practice', description: 'A person, always. Agents may draft.' },
}

const DEFAULT_CHANGED = at('2026-06-03', '09:00')

function rule(r: Pick<Rule, 'id' | 'label' | 'tier' | 'agent' | 'action' | 'mode'> & Partial<Rule>, sort: number): Rule {
  return {
    version: 1,
    origin: 'authored',
    scope: { payer_key: null, item_type: 'all', max_cents: null },
    confidence_floor: null,
    outcome_metric: 'none',
    reverses_in: 'none',
    requires_owner_signoff: r.tier === 2,
    signed_by: null,
    signed_at: null,
    changed_by: 'usr_dana',
    changed_at: DEFAULT_CHANGED,
    base_rate: { n: 0, k: 0 },
    description: '',
    ...r,
    sort,
  }
}

const SIGNED = { signed_by: 'usr_morgan', changed_by: 'usr_morgan' } as const

export function buildRules(): Rule[] {
  return [
    { id: 'rule_t1_status_check', label: 'Status check · day 30, then every 15 d', tier: 1, agent: 'followup', action: 'status_check', mode: 'ask', base_rate: { n: 142, k: 139 }, description: 'Portal → IVR → 276 status inquiry on accepted claims.' },
    { id: 'rule_t1_records_request', label: 'Payer records request → send via NEA', tier: 1, agent: 'followup', action: 'records_request', mode: 'auto', scope: { payer_key: null, item_type: 'all', max_cents: 200_000 }, confidence_floor: 0.9, outcome_metric: 'paid_30d', base_rate: { n: 97, k: 91 }, changed_at: at('2026-05-22', '10:00') },
    { id: 'rule_t1_delta_pa', label: 'Missing PA x-ray (CO-16 · N29) → attach, resubmit', tier: 1, agent: 'followup', action: 'resubmit_with_attachment', mode: 'ask', scope: { payer_key: 'delta_ny', item_type: 'denied:CO-16:N29:pa_missing', max_cents: null }, outcome_metric: 'paid_30d', base_rate: { n: 25, k: 23 }, changed_at: at('2026-10-26', '10:02') },
    { id: 'rule_t1_reprocessing', label: 'Prompt-pay reprocessing request (NY §3224-a)', tier: 1, agent: 'followup', action: 'reprocessing_request', mode: 'ask', outcome_metric: 'paid_30d', base_rate: { n: 25, k: 22 }, changed_at: at('2026-07-01', '09:00') },
    { id: 'rule_t1_request_835', label: 'Request 835 for an unmatched deposit', tier: 1, agent: 'posting', action: 'request_835', mode: 'auto', base_rate: { n: 14, k: 14 } },
    { id: 'rule_t1_send_claim', label: 'Send claim · PMS codes and rule-named attachments', tier: 1, agent: 'claims', action: 'send_claim_pms_codes', mode: 'auto', outcome_metric: 'accepted', reverses_in: 'until_file_leaves', base_rate: { n: 388, k: 376 }, version: 3, changed_at: at('2026-10-26', '10:02') },
    { id: 'rule_t1_fix_demographics', label: 'Clearinghouse reject → fix demographics to the PMS value, resend', tier: 1, agent: 'claims', action: 'fix_demographics_resend', mode: 'auto', scope: { payer_key: null, item_type: 'all', max_cents: 200_000 }, confidence_floor: 0.9, outcome_metric: 'accepted', reverses_in: 'until_file_leaves', base_rate: { n: 19, k: 16 }, changed_at: at('2026-05-14', '11:00') },
    { id: 'rule_t1_eligibility_check', label: 'Eligibility check · portal → 271 → IVR', tier: 1, agent: 'eligibility', action: 'eligibility_check', mode: 'auto' },
    { id: 'rule_t1_payer_rep_call', label: 'Payer rep call (bounded asks)', tier: 1, agent: 'followup', action: 'payer_rep_call', mode: 'auto', base_rate: { n: 9, k: 9 }, changed_at: at('2026-05-20', '09:30') },
    { id: 'rule_t2_post_era', label: 'Post ERA line · balanced and patient share matches tracked benefits', tier: 2, agent: 'posting', action: 'post_era_line', mode: 'auto', ...SIGNED, signed_at: at('2026-06-11', '16:00'), scope: { payer_key: null, item_type: 'all', max_cents: 500_000 }, outcome_metric: 'balanced', reverses_in: 'until_day_close', base_rate: { n: 92, k: 90 }, changed_at: at('2026-06-11', '16:00') },
    { id: 'rule_t2_update_benefits', label: 'Plan change found on 271 → update PMS benefits', tier: 2, agent: 'eligibility', action: 'update_pms_benefits', mode: 'auto', ...SIGNED, signed_at: at('2026-06-03', '09:00'), confidence_floor: 0.95, reverses_in: 'until_day_close', base_rate: { n: 212, k: 211 } },
    { id: 'rule_t2_agent_text_delta_crowns', label: 'Send claim · agent text · Delta × crowns', tier: 2, agent: 'claims', action: 'send_claim_agent_text', mode: 'auto', ...SIGNED, signed_at: at('2026-09-14', '12:10'), scope: { payer_key: 'delta_ny', item_type: 'crown_narrative', max_cents: null }, outcome_metric: 'accepted', reverses_in: 'until_file_leaves', base_rate: { n: 31, k: 30 }, changed_at: at('2026-09-14', '12:10') },
    { id: 'rule_t2_corrected_claim', label: 'Corrected claim (frequency 7) for a data error', tier: 2, agent: 'claims', action: 'corrected_claim', mode: 'ask', scope: { payer_key: null, item_type: 'all', max_cents: 50_000 }, outcome_metric: 'accepted', reverses_in: 'void_only', changed_by: 'usr_morgan', changed_at: at('2026-05-28', '10:00') },
    { id: 'rule_t2_patient_transfer', label: 'Patient-responsibility transfer (max met, alternate benefit)', tier: 2, agent: 'posting', action: 'patient_transfer', mode: 'ask' },
    { id: 'rule_t2_send_statement', label: 'Send statement', tier: 2, agent: 'posting', action: 'send_statement', mode: 'ask' },
    { id: 'rule_t2_mechanical_refund', label: 'Mechanical overpayment refund to the original tender ≤ $100', tier: 2, agent: 'posting', action: 'mechanical_refund', mode: 'auto', ...SIGNED, signed_at: at('2026-10-27', '17:05'), scope: { payer_key: null, item_type: 'all', max_cents: 10_000 }, changed_at: at('2026-10-27', '17:05') },
    { id: 'rule_t3_writeoff_void', label: 'Write-off, void', tier: 3, agent: 'posting', action: 'write_off', mode: 'human_only', changed_by: 'usr_morgan', description: 'Also covers void_claim (frequency 8).' },
    { id: 'rule_t3_formal_appeal', label: 'Formal appeal · the rendering dentist signs', tier: 3, agent: 'appeals', action: 'formal_appeal', mode: 'human_only', changed_by: 'usr_morgan' },
    { id: 'rule_t3_refund_waiver_collections', label: 'Discretionary refund, waiver, collections referral', tier: 3, agent: 'posting', action: 'discretionary_refund', mode: 'human_only', changed_by: 'usr_morgan', description: 'Also covers waiver and collections_referral.' },
  ].map((r, i) => rule(r as Parameters<typeof rule>[0], i))
}

export function buildRuleChanges(): RuleChange[] {
  return [
    { id: 'rch_5', rule_id: 'rule_t1_send_claim', at: at('2026-10-26', '10:02'), by: 'usr_dana', before: { attachment_rule: 'Delta D27xx → BWX' }, after: { attachment_rule: 'Delta D27xx → PA, not BWX' }, items_affected_since: 2, summary: 'Delta D27xx crowns → attach the PA, not the BWX (found 2 more)' },
    { id: 'rch_4', rule_id: 'rule_t2_mechanical_refund', at: at('2026-10-27', '17:05'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto', signed_by: 'usr_morgan' }, items_affected_since: 0, summary: 'Signed: mechanical refund to the original tender ≤ $100' },
    { id: 'rch_3', rule_id: 'rule_t2_agent_text_delta_crowns', at: at('2026-09-14', '12:10'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto', signed_by: 'usr_morgan' }, items_affected_since: 14, summary: 'Signed: agent-written narratives on Delta crown claims' },
    { id: 'rch_2', rule_id: 'rule_t2_post_era', at: at('2026-06-11', '16:00'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto', signed_by: 'usr_morgan' }, items_affected_since: 61, summary: 'Signed: post balanced ERA lines on contract' },
    { id: 'rch_1', rule_id: 'rule_t2_update_benefits', at: at('2026-06-03', '09:00'), by: 'usr_morgan', before: { mode: 'ask' }, after: { mode: 'auto', signed_by: 'usr_morgan' }, items_affected_since: 40, summary: 'Signed: update PMS benefits from a 271 plan change' },
  ]
}

const DELTA_DRAFT = {
  rule_id: 'rule_t1_delta_pa',
  action: 'resubmit_with_attachment',
  tier: 1,
  mode: 'auto',
  scope: { payer_key: 'delta_ny', item_type: 'denied:CO-16:N29:pa_missing', max_cents: 200_000 },
  confidence_floor: 0.9,
  outcome_metric: 'paid_30d',
}

export function buildProposals(): RuleProposal[] {
  return [
    {
      id: 'prop_delta_pa',
      title: 'Delta · missing PA x-ray · resubmits under $2,000',
      rule_draft: { ...DELTA_DRAFT, root_cause_class: 'payer' },
      evidence: { approved: 24, total: 25, outcome_k: 23, outcome_n: 25 },
      root_cause_guard: false,
      state: 'open',
      created_at: at('2026-10-28', '06:15'),
      watching: false,
      note: 'You approved 24 of 25 Delta CO-16 · N29 resubmissions under $2,000 in 12 months; 23 were paid within 30 days.',
    },
    {
      id: 'prop_delta_pa_ours',
      title: 'Delta · missing PA x-ray · when our Claims agent attached the wrong image',
      rule_draft: { ...DELTA_DRAFT, root_cause_class: 'ours' },
      evidence: { approved: 3, total: 3, outcome_k: 0, outcome_n: 0 },
      root_cause_guard: true,
      state: 'open',
      created_at: at('2026-10-28', '06:15'),
      watching: false,
      note: 'Root cause: ours. Fix the upstream rule (done 10/26); this slice can never run without review.',
    },
    {
      id: 'prop_guardian_5mm',
      title: 'Guardian · SRP with ≥ 5 mm pockets · send chart up front',
      rule_draft: { action: 'send_claim_pms_codes', scope: { payer_key: 'guardian', item_type: 'srp_chart_attached' }, mode: 'auto' },
      evidence: { approved: 1, total: 1, outcome_k: 0, outcome_n: 0 },
      root_cause_guard: false,
      state: 'open',
      created_at: at('2026-10-22', '02:00'),
      watching: true,
      note: 'Watching · n = 1. Shown so you can see it coming; not acceptable until n ≥ 20.',
    },
  ]
}

/** Which rule each of the 12 seeded inbox items was proposed under (API: InboxItem.rule_id). */
export const ITEM_RULE: Record<string, string> = {
  inb_4821: 'rule_t1_delta_pa',
  inb_4836: 'rule_t1_delta_pa',
  inb_4840: 'rule_t1_delta_pa',
  inb_4705: 'rule_t1_reprocessing',
  inb_4851: 'rule_t1_fix_demographics',
  inb_4772: 'rule_t2_post_era',
  inb_4748: 'rule_t2_patient_transfer',
}
