/**
 * Inbox fixture at Wed 10/28 10:40: 12 open items = 9 claim items + 3 eligibility items
 * (docs/spec/04-seed.md "Inbox open"), in server priority order. The Delta missing-PA group of 3 is first.
 */
import type { Evidence, InboxGroup, InboxItemDetail } from '@/api/schema'
import { at } from './claims'

/**
 * The mock's stored inbox row, shaped like the API's domain `InboxItem`: ids (`claim_id`, `evidence_ids`), not
 * nested references. db.ts builds the wire shapes from it the way the API's read models do
 * (`InboxItemOut` = row + `claim`/`patient` refs + priority; `InboxItemDetail` adds hydrated evidence and the
 * hold window). Nothing outside src/mocks sees this type.
 */
export type MockInboxItem = Omit<InboxItemDetail, 'claim' | 'patient' | 'priority' | 'suspicious_evidence' | 'evidence' | 'hold_window' | 'payload' | 'summary'> & {
  claim_id?: string | null
  summary?: string | null
  payload?: Record<string, unknown>
}

export const GROUP_DELTA_PA = 'delta_ny:resubmit_with_attachment'

export const GROUP_META: Record<string, Pick<InboxGroup, 'title' | 'summary'>> = {
  [GROUP_DELTA_PA]: {
    title: 'Delta Dental · missing PA x-ray',
    summary: 'CO-16 · N29 on 3 crowns · same fix: attach PA via NEA, resubmit',
  },
}

const PA_BASIS = '23 of 25 Delta CO-16 · N29 denials paid within 30 d after a PA resubmit (12 mo)'

function paEvidence(n: number, tooth: string, date: string): Evidence[] {
  return [
    {
      id: `ev_${n}_portal`,
      kind: 'portal_screenshot',
      title: 'Delta portal · claim status',
      excerpt: `Denied 10/26 · CO-16 N29 · paid $0.00 · ICN on file`,
      captured_at: at('2026-10-27', '16:02'),
      reference: n === 4821 ? '26299-041833' : `26299-0${n}9`,
      uri: null,
    },
    {
      id: `ev_${n}_pms`,
      kind: 'pms_record',
      title: `PA x-ray, tooth #${tooth} · PMS imaging`,
      excerpt: `D0220 periapical #${tooth} · captured ${date} 10:41 · not sent with the claim`,
      captured_at: at('2026-10-28', '06:15'),
      reference: `IMG-${n}-PA`,
      uri: null,
    },
    {
      id: `ev_${n}_era`,
      kind: 'era_line',
      title: `Delta 835 · 10/26 · D27xx #${tooth}`,
      excerpt: 'CO-16 · N29 — claim lacks information; N29: missing documentation (pre-operative radiograph required). Paid $0.00.',
      captured_at: at('2026-10-26', '06:05'),
      reference: 'TRN 1DD2629904',
      uri: null,
    },
  ]
}

export const EVIDENCE: Evidence[] = [
  ...paEvidence(4821, '19', '10/12'),
  ...paEvidence(4836, '3', '10/14'),
  ...paEvidence(4840, '14', '10/19'),
  {
    id: 'ev_4733_prior',
    kind: 'prior_eob',
    title: 'Delta EOB 03/2022 · crown #31',
    excerpt: 'D2740 #31 paid 03/2022. Delta tooth history lists it as #30; the real prior #30 crown was seated 2019-08-14.',
    captured_at: at('2026-10-28', '06:40'),
    reference: 'EOB 2022-03-118842',
  },
  {
    id: 'ev_4733_era',
    kind: 'era_line',
    title: 'Delta 835 · CO-119 · D2740 #30',
    excerpt: 'CO-119 — benefit maximum for this time period or occurrence has been reached (frequency).',
    captured_at: at('2026-10-21', '06:10'),
    reference: 'TRN 1DD2629411',
  },
  {
    id: 'ev_4611_portal',
    kind: 'portal_screenshot',
    title: 'Delta portal · benefits',
    excerpt: 'Annual maximum $1,500 · used $1,500 · remaining $0.00 (as of 10/27)',
    captured_at: at('2026-10-27', '15:10'),
    reference: 'portal 10/27',
  },
  {
    id: 'ev_4705_rep',
    kind: 'rep_call',
    title: 'MetLife rep call · 9m 40s',
    excerpt: '“No request for information on file. Claim is in process.” Day 64 of a clean claim.',
    captured_at: at('2026-10-27', '14:30'),
    reference: 'ML-58213',
  },
  {
    id: 'ev_4705_policy',
    kind: 'policy_clause',
    title: 'NY Ins. Law § 3224-a',
    excerpt: 'Undisputed electronic claims must be paid within 30 days of receipt.',
    captured_at: at('2026-10-27', '14:31'),
  },
  {
    id: 'ev_4851_pms',
    kind: 'pms_record',
    title: '271 response · new subscriber id',
    excerpt: 'Cigna 271 10/27 returns subscriber id U8841 2207 (PMS has U8841 2270).',
    captured_at: at('2026-10-28', '07:02'),
    reference: '271-1027-334',
  },
  {
    id: 'ev_4772_era',
    kind: 'era_line',
    title: 'Cigna ERA 10/28 · D2392 #19',
    excerpt: 'Allowed $136.00 · PR-1 deductible $32.00 applied · paid $76.80. Deductible was met 05/12 (EOB on file).',
    captured_at: at('2026-10-28', '06:20'),
    reference: 'TRN CIG-1028-77',
  },
  {
    id: 'ev_4748_era',
    kind: 'era_line',
    title: 'Aetna ERA · D2392 #14 → D2140',
    excerpt: 'Alternate benefit applied (amalgam D2140). Patient difference $38.00 · not appealable under plan.',
    captured_at: at('2026-10-27', '09:00'),
    reference: 'TRN AET-1027-12',
  },
  {
    id: 'ev_chen_portal',
    kind: 'portal_screenshot',
    title: 'MetLife portal · J. Chen benefits',
    excerpt: 'Annual max $1,500 · used $1,320 · remaining $180 (as of 10/28 6:12 AM)',
    captured_at: at('2026-10-28', '06:12'),
  },
  {
    id: 'ev_kim_271',
    kind: 'pms_record',
    title: 'Guardian portal · S. Kim frequencies',
    excerpt: 'D0274 bitewings: 1 per 12 months · last 11/03/2025 · next eligible 11/03/2026.',
    captured_at: at('2026-10-28', '06:12'),
  },
  {
    id: 'ev_park_ivr',
    kind: 'ivr_transcript',
    title: 'MetLife IVR · N. Park',
    excerpt: '“Our systems are currently unavailable. Please try again later.” (05:40, 06:14) · 271: no plan detail returned.',
    captured_at: at('2026-10-28', '06:14'),
    reference: 'IVR-1028-0912',
  },
]

const base = {
  state: 'open' as const,
  plan_steps: [] as string[],
  appointment_id: null,
  snoozed_until: null,
  resolved_by: null,
  resolved_at: null,
  run_id: null,
  group_key: null,
  root_cause: null,
  audit_note: null,
}

function paItem(n: number, patient: string, tooth: string, cents: number, pct: number, created: string): MockInboxItem {
  return {
    ...base,
    id: `inb_${n}`,
    kind: 'approve_action',
    claim_id: `clm_${n}`,
    agent: 'followup',
    title: `#${n} · ${patient} · D27xx #${tooth}`,
    recommendation: `Upload the PA of #${tooth} to NEA; resubmit with the NEA# and the original claim number.`,
    summary: 'Denied CO-16 · N29: pre-op radiograph required. Our Claims agent sent the BWX, not the PA; rule fixed 10/26.',
    confidence: { pct, basis: PA_BASIS },
    evidence_ids: [`ev_${n}_portal`, `ev_${n}_pms`, `ev_${n}_era`],
    proposed_action: { action: 'resubmit_with_attachment', params: { attachment: 'pa', tooth, file: 'delta_ny 11:15' }, cents, requires_hold_window: true },
    plan_steps: [
        `Upload PA #${tooth} (PMS imaging, ${created} 10:41) to NEA FastAttach`,
        'Resubmit: NEA# in the attachment field, note cites the ICN',
        'Send in the 11:15 Delta file via Vyne (the NEA# misses 10:45)',
        'Keep the day-30 status check',
    ],
    tier: 1,
    group_key: GROUP_DELTA_PA,
    created_at: at('2026-10-28', '06:15'),
    cents: cents,
    root_cause: 'ours',
    audit_note: 'root cause: ours — Claims agent attached BWX; rule updated 10/26',
  }
}

export function buildInbox(): MockInboxItem[] {
  return [
    paItem(4821, 'K. Owens', '19', 124000, 92, '10/12'),
    paItem(4836, 'L. Grant', '3', 118000, 95, '10/14'),
    paItem(4840, 'F. Diaz', '14', 131000, 93, '10/19'),
    {
      ...base,
      id: 'inb_4733',
      kind: 'review_draft',
      claim_id: 'clm_4733',
      agent: 'appeals',
      title: '#4733 · J. Webb · claim inquiry drafted',
      recommendation: 'Send a claim inquiry with Delta’s own 03/2022 EOB: their tooth history puts a 2022 crown on #30 that was #31.',
      summary: 'Frequency denial (CO-119): payer tooth-# error. Review the drafted inquiry?',
      confidence: { pct: 82, basis: '5 of 6 reconsiderations won (12 mo)' },
      evidence_ids: ['ev_4733_prior', 'ev_4733_era'],
      proposed_action: { action: 'send_claim_agent_text', params: { channel: 'portal inquiry' }, cents: 0, requires_hold_window: false },
      plan_steps: ['Attach the 03/2022 EOB', 'Send the inquiry text (drafted, cites the EOB)'],
      tier: 2,
      created_at: at('2026-10-28', '06:40'),
      cents: 124000,
      root_cause: 'payer',
    },
    {
      ...base,
      id: 'inb_4611',
      kind: 'approve_action',
      claim_id: 'clm_4611',
      agent: 'posting',
      title: '#4611 · R. Diaz · max met',
      recommendation: 'Transfer allowed $1,012 to the patient and post the $228 contractual adjustment.',
      summary: 'Max met (PR-119). Bill patient allowed $1,012, contractual $228?',
      confidence: { pct: 96, basis: 'max confirmed on portal 10/27' },
      evidence_ids: ['ev_4611_portal'],
      proposed_action: { action: 'write_off', params: { patient_cents: 101200, writeoff_cents: 22800 }, cents: 22800, requires_hold_window: false },
      plan_steps: ['Move $1,012 to patient responsibility', 'Write off the $228 contractual difference (tier 3 · Dr. Morgan)', 'Statement goes in the next run'],
      tier: 3, // the API seed's tier: the contractual write-off commits the practice
      created_at: at('2026-10-27', '15:10'),
      cents: 124000,
      root_cause: 'patient',
    },
    {
      ...base,
      id: 'inb_4705',
      kind: 'approve_action',
      claim_id: 'clm_4705',
      agent: 'followup',
      title: '#4705 · T. Brooks · day 64',
      recommendation: 'Send a NY prompt-pay reprocessing request citing § 3224-a and the 10/27 rep call.',
      summary: 'Clean claim, 64 days. Send NY prompt-pay reprocessing request?',
      confidence: { pct: 88, basis: '7 of 8 prompt-pay requests paid within 15 d' },
      evidence_ids: ['ev_4705_rep', 'ev_4705_policy'],
      proposed_action: { action: 'reprocessing_request', params: { basis: 'ny_prompt_pay' }, cents: 0, requires_hold_window: false },
      tier: 1,
      created_at: at('2026-10-27', '14:35'),
      cents: 115000,
      root_cause: 'payer',
    },
    {
      ...base,
      id: 'inb_4851',
      kind: 'approve_action',
      claim_id: 'clm_4851',
      agent: 'claims',
      title: '#4851 · I. Moreau · 277CA reject',
      recommendation: 'Update the subscriber id from the 271 and resend in the next Cigna file.',
      summary: 'Subscriber ID not found; 271 has a new ID. Update & resend?',
      confidence: { pct: 84, basis: '21 of 25 A7:164 fixes accepted on resend' },
      evidence_ids: ['ev_4851_pms'],
      proposed_action: { action: 'fix_demographics_resend', params: { field: 'subscriber_id' }, cents: 0, requires_hold_window: false },
      tier: 1,
      created_at: at('2026-10-28', '07:02'),
      cents: 39500,
      root_cause: 'patient',
    },
    {
      ...base,
      id: 'inb_4772',
      kind: 'variance',
      claim_id: 'clm_4772',
      agent: 'posting',
      title: '#4772 · D. Foster · underpaid $32',
      recommendation: 'Hold the $32 variance for reprocessing (deductible was met 05/12). Not a write-off.',
      summary: 'Cigna ERA hold: PR-1 deductible applied though met 05/12.',
      confidence: { pct: 90, basis: 'deductible met per 05/12 EOB' },
      evidence_ids: ['ev_4772_era'],
      proposed_action: { action: 'post_era_line', params: { hold_variance_cents: 3200, then: 'reprocessing_request' }, cents: 3200, requires_hold_window: false },
      tier: 2, // posting a line is tier 2 (rule_t2_post_era); the line was held because it does not match tracked benefits
      created_at: at('2026-10-28', '06:20'),
      cents: 3200,
      root_cause: 'payer',
    },
    {
      ...base,
      id: 'inb_4748',
      kind: 'approve_action',
      claim_id: 'clm_4748',
      agent: 'posting',
      title: '#4748 · L. Osei · alternate benefit',
      recommendation: 'Bill the patient the $38 alternate-benefit difference (not appealable under the plan).',
      summary: 'Aetna alternate benefit D2140 applied. Bill patient difference?',
      confidence: { pct: 94, basis: 'plan language: alternate benefit, no appeal' },
      evidence_ids: ['ev_4748_era'],
      proposed_action: { action: 'patient_transfer', params: { cents: 3800 }, cents: 0, requires_hold_window: false },
      tier: 2,
      created_at: at('2026-10-27', '09:00'),
      cents: 3800,
      root_cause: 'patient',
    },
    {
      ...base,
      id: 'inb_elig_chen',
      kind: 'eligibility_flag',
      claim_id: null,
      appointment_id: 'appt_chen_1029',
      agent: 'eligibility',
      title: 'J. Chen · Thu 9:00 · max left $180',
      recommendation: 'Tell the front desk: plan pays $180 of $650 planned; patient estimate $470.',
      summary: 'Annual max nearly used. Flag the shortfall to the front desk?',
      confidence: { pct: 97, basis: 'portal as of 10/28 6:12 AM' },
      evidence_ids: ['ev_chen_portal'],
      proposed_action: { action: 'eligibility_check', params: { notify: 'front_desk' }, cents: 0, requires_hold_window: false },
      tier: 1,
      created_at: at('2026-10-28', '06:12'),
      cents: 47000,
    },
    {
      ...base,
      id: 'inb_elig_kim',
      kind: 'eligibility_flag',
      claim_id: null,
      appointment_id: 'appt_kim_1029',
      agent: 'eligibility',
      title: 'S. Kim · Thu 1:00 · bitewings not covered until 11/03',
      recommendation: 'Bitewings are not covered until 11/03 (last 11/03/2025). Skip D0274 or have the patient sign the non-covered acknowledgment.',
      summary: 'D0274 frequency: next eligible 11/03.',
      confidence: { pct: 91, basis: 'Guardian portal as of 10/28 6:12 AM' },
      evidence_ids: ['ev_kim_271'],
      proposed_action: { action: 'eligibility_check', params: { notify: 'front_desk' }, cents: 0, requires_hold_window: false },
      tier: 1,
      created_at: at('2026-10-28', '06:12'),
      cents: 5800,
    },
    {
      ...base,
      id: 'inb_elig_park',
      kind: 'eligibility_flag',
      claim_id: null,
      appointment_id: 'appt_park_1030',
      agent: 'eligibility',
      title: 'N. Park · Fri 9:00 · unverified (portal down)',
      recommendation: 'MetLife portal and IVR unavailable since 05:40; 271 returned no plan detail. Verify at check-in or call MetLife.',
      summary: 'Portal down; unverified.',
      confidence: { pct: null, basis: 'could not verify: MetLife portal and IVR down since 05:40' },
      evidence_ids: ['ev_park_ivr'],
      proposed_action: { action: 'eligibility_check', params: { channel: 'rep_call' }, cents: 0, requires_hold_window: false },
      tier: 1,
      created_at: at('2026-10-28', '06:14'),
      cents: 63900,
    },
  ]
}
