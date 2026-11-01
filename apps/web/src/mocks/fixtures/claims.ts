/**
 * Claims fixture: the pinned records of docs/spec/04-seed.md plus generated filler that makes the
 * reconciled 10:40 numbers come out exactly (107 open · Ready 6 $3,210 · Sent 5 $1,320 · Rejected 2 $830 ·
 * Accepted 24 $17,640 · Pending 57 $46,520 · Denied 5 $6,210 · Appealed 3 $1,920 · Partial 5 $1,060 ·
 * Paid Oct 118 $61,300). Deterministic: a fixed PRNG seed, no wall clock.
 */
import type {
  AckEvent,
  AgentKind,
  Attachment,
  ClaimDetail,
  ClaimLine,
  ClaimStatus,
  Deadline,
  Denial,
  Hold,
  PayerKey,
  ReadinessCheck,
  TimelineEntry,
} from '@/api/schema'

export const FROZEN_NOW = '2026-10-28T10:40:00-04:00'

/** Server-side record: the detail shape plus the list-row denormalisations. */
export interface MockClaim extends Omit<ClaimDetail, 'open_inbox_items' | 'needs_action'> {
  location_id: 'loc_downtown' | 'loc_riverside'
  patient_name: string
  procedures_label: string
  agent_chip: { agent: AgentKind; label: string } | null
  last_activity: { at: string; label: string } | null
  /** A queued payer-file entry (API `FileEntry` state=queued): the claim is editable until the file leaves. */
  queued_file?: { at: string; kind: 'original' | 'resubmit' | 'corrected' } | null
  /** An open hold (API `Hold`): the claim is on Today's claims under "Held". */
  hold?: Hold | null
}

// ── tiny deterministic PRNG ──────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000
const NOW_MS = Date.parse(FROZEN_NOW)
/** ISO date (YYYY-MM-DD) `days` before the frozen clock, in practice-local terms. */
export function daysAgo(days: number): string {
  const d = new Date(NOW_MS - days * DAY - 4 * 3_600_000)
  return d.toISOString().slice(0, 10)
}
export function at(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00-04:00`
}

const FIRST = ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.', 'H.', 'J.', 'K.', 'L.', 'M.', 'N.', 'P.', 'R.', 'S.', 'T.', 'V.', 'W.']
const LAST = [
  'Abbott', 'Bello', 'Carver', 'Dalton', 'Ellery', 'Farrow', 'Gaines', 'Hollis', 'Ingram', 'Jessup', 'Keane', 'Larkin',
  'Mercer', 'Nolan', 'Okafor', 'Pruitt', 'Quill', 'Rowan', 'Sutter', 'Tolliver', 'Underhill', 'Vance', 'Whitlock',
  'Yarrow', 'Zeller', 'Ashby', 'Brandt', 'Corwin', 'Devlin', 'Easton', 'Fennick', 'Galloway', 'Hartigan', 'Iverson',
  'Juno', 'Kessler', 'Lomax', 'Marlow', 'Novak', 'Orsini', 'Pemberton', 'Radcliffe', 'Sorensen', 'Thackery', 'Upton',
]
const PROCS: { cdt: string; desc: string; tooth: boolean }[] = [
  { cdt: 'D0120', desc: 'Periodic oral evaluation', tooth: false },
  { cdt: 'D1110', desc: 'Prophylaxis, adult', tooth: false },
  { cdt: 'D0274', desc: 'Bitewings, four films', tooth: false },
  { cdt: 'D2391', desc: 'Resin composite, one surface, posterior', tooth: true },
  { cdt: 'D2392', desc: 'Resin composite, two surfaces, posterior', tooth: true },
  { cdt: 'D2740', desc: 'Crown, porcelain/ceramic', tooth: true },
  { cdt: 'D2950', desc: 'Core buildup', tooth: true },
  { cdt: 'D3330', desc: 'Endodontic therapy, molar', tooth: true },
  { cdt: 'D4341', desc: 'Periodontal scaling and root planing, 4+ teeth', tooth: false },
  { cdt: 'D4910', desc: 'Periodontal maintenance', tooth: false },
  { cdt: 'D7140', desc: 'Extraction, erupted tooth', tooth: true },
]
const PAYERS: PayerKey[] = ['delta_ny', 'delta_ny', 'delta_ny', 'metlife', 'metlife', 'cigna', 'aetna', 'guardian']
const PROVIDERS = ['Dr. Morgan', 'Dr. Lee', 'RDH M. Cole']

const ALL_PASS: ReadinessCheck[] = [
  { key: 'note_signed', status: 'pass', detail: 'Note signed at checkout' },
  { key: 'procs_match_note', status: 'pass', detail: 'Procedures match the clinical note' },
  { key: 'fee_schedule', status: 'pass', detail: 'Practice fee schedule' },
  { key: 'subscriber_id_format', status: 'pass', detail: 'Subscriber id matches payer format' },
  { key: 'eligibility_fresh', status: 'pass', detail: 'Eligibility verified within 7 days' },
  { key: 'attachment_rule', status: 'na', detail: 'No attachment required' },
  { key: 'duplicate', status: 'pass', detail: 'No duplicate claim on file' },
  { key: 'timely_filing', status: 'pass', detail: 'Inside the timely-filing window' },
]

function acksFor(status: ClaimStatus, id: string, sentDate: string, icn: string | null): AckEvent[] {
  if (status === 'ready') return []
  const out: AckEvent[] = [
    { id: `${id}_ack1`, claim_id: id, stage: 'file_999_ok', code: null, message: 'File accepted (999)', at: at(sentDate, '10:46') },
    { id: `${id}_ack2`, claim_id: id, stage: 'ch_277ca_a1', code: 'A1', message: 'Vyne 277CA accepted, forwarded to payer', at: at(sentDate, '11:02') },
  ]
  if (status === 'sent') return out.slice(0, 1)
  if (status === 'rejected') return [out[0] as AckEvent, { id: `${id}_ack2`, claim_id: id, stage: 'ch_277ca_a7', code: 'A7:164', message: 'Vyne 277CA rejected · invalid subscriber id', at: at(sentDate, '11:02') }]
  out.push({ id: `${id}_ack3`, claim_id: id, stage: 'payer_277ca_a1', code: 'A1', message: `Payer accepted · ICN ${icn ?? '—'}`, at: at(sentDate, '23:10') })
  return out
}

function ackStage(status: ClaimStatus): MockClaim['ack_stage'] {
  if (status === 'ready') return 'none'
  if (status === 'sent') return 'file_999_ok'
  if (status === 'rejected') return 'ch_277ca_a7'
  return 'payer_277ca_a1'
}

interface Pin {
  number: number
  patient: string
  payer: PayerKey
  status: ClaimStatus
  ageDays: number
  billed: number // dollars
  procs: string
  reason?: string
  agent?: { agent: AgentKind; label: string }
  last?: { at: string; label: string }
  provider?: string
  /** Today's claims (10/28): built at checkout hh:mm, left (or leaves) in the hh:mm file. */
  built?: string
  file?: string
  /** Vyne A7 that the Claims agent fixed and resent (Iqbal). */
  a7Fixed?: boolean
  denial?: Denial
  deadline?: Deadline
  hold?: Omit<Hold, 'id' | 'subject' | 'subject_id'>
  queued?: string
}

const DELTA_PA_DENIAL: Denial = { carc: 'CO-16', rarc: 'N29', decoded: 'Missing documentation: pre-operative radiograph required', root_cause: 'ours' }
const DELTA_PA_DEADLINE: Deadline = { kind: 'appeal', due_on: '2027-04-24', basis: 'Delta: 180 days from the 10/26 ERA' }

/** The named records the demo and mocks reference. Amounts in dollars for readability. */
const PINS: Pin[] = [
  { number: 4821, patient: 'K. Owens', payer: 'delta_ny', status: 'denied', ageDays: 16, billed: 1240, procs: 'D2740 #19 +2', reason: 'CO-16 · N29', agent: { agent: 'followup', label: 'fix proposed · group' }, last: { at: at('2026-10-28', '06:15'), label: 'proposal' } },
  { number: 4836, patient: 'L. Grant', payer: 'delta_ny', status: 'denied', ageDays: 13, billed: 1180, procs: 'D2750 #3 +1', reason: 'CO-16 · N29', denial: DELTA_PA_DENIAL, deadline: DELTA_PA_DEADLINE, agent: { agent: 'followup', label: 'fix proposed · group' }, last: { at: at('2026-10-28', '06:15'), label: 'proposal' } },
  { number: 4840, patient: 'F. Diaz', payer: 'delta_ny', status: 'denied', ageDays: 8, billed: 1310, procs: 'D2740 #14 +2', reason: 'CO-16 · N29', denial: DELTA_PA_DENIAL, deadline: DELTA_PA_DEADLINE, agent: { agent: 'followup', label: 'fix proposed · group' }, last: { at: at('2026-10-28', '06:15'), label: 'proposal' } },
  {
    number: 4733, patient: 'J. Webb', payer: 'delta_ny', status: 'denied', ageDays: 37, billed: 1240, procs: 'D2740 #30', reason: 'CO-119 · freq.',
    denial: { carc: 'CO-119', rarc: null, decoded: 'Benefit maximum or frequency for this period has been reached', root_cause: 'payer' },
    deadline: { kind: 'appeal', due_on: '2027-04-20', basis: 'Delta: 180 days from the 10/22 ERA' },
    agent: { agent: 'appeals', label: 'inquiry drafted' }, last: { at: at('2026-10-28', '06:40'), label: 'draft' } },
  {
    number: 4611, patient: 'R. Diaz', payer: 'delta_ny', status: 'denied', ageDays: 82, billed: 1240, procs: 'D2740 #30', reason: 'PR-119 · max met',
    denial: { carc: 'PR-119', rarc: null, decoded: 'Annual maximum met: patient responsibility', root_cause: 'payer' },
    deadline: { kind: 'none', due_on: null, basis: 'closes in Payments' },
    agent: { agent: 'posting', label: 'pt. transfer proposed' }, last: { at: at('2026-10-27', '15:10'), label: 'portal: max met' } },
  { number: 4705, patient: 'T. Brooks', payer: 'metlife', status: 'pending', ageDays: 64, billed: 1150, procs: 'D3330 #3', reason: 'clean · no RFI', agent: { agent: 'followup', label: 'prompt-pay req. proposed' }, last: { at: at('2026-10-27', '14:30'), label: 'ref # ML-58213' } },
  { number: 4512, patient: 'G. Hill', payer: 'aetna', status: 'pending', ageDays: 104, billed: 2290, procs: 'D3310 #8, D2740 #8', reason: 'in process', agent: { agent: 'followup', label: 'rep call · on hold' }, last: { at: at('2026-10-28', '10:31'), label: 'rep call' } },
  { number: 4744, patient: 'P. Hale', payer: 'metlife', status: 'pending', ageDays: 42, billed: 3450, procs: 'D6240 #14, D6750 #13 #15', reason: 'pended for info', last: { at: at('2026-10-22', '09:12'), label: 'portal correspondence' } },
  { number: 4709, patient: 'S. Brandt', payer: 'cigna', status: 'pending', ageDays: 52, billed: 1365, procs: 'D2950 #3, D2740 #3', reason: 'consultant review', last: { at: at('2026-10-27', '11:05'), label: 'IVR status check' } },
  { number: 4731, patient: 'E. Corwin', payer: 'guardian', status: 'pending', ageDays: 47, billed: 410, procs: 'D7210 #17', reason: 'adjusted · no 835', last: { at: at('2026-10-26', '08:40'), label: 'portal status' } },
  // The overnight 835s of demo step 8 deny these four (Ito CO-50·N10, Castillo CO-16·M127, Moreno CO-22, Morris CO-29).
  { number: 4796, patient: 'L. Ito', payer: 'guardian', status: 'pending', ageDays: 19, billed: 480, procs: 'D4341 UR, UL', provider: 'Dr. Lee' },
  { number: 4797, patient: 'A. Castillo', payer: 'guardian', status: 'pending', ageDays: 19, billed: 390, procs: 'D4341 LR, D4342 LL', provider: 'Dr. Lee' },
  { number: 4800, patient: 'S. Moreno', payer: 'aetna', status: 'pending', ageDays: 15, billed: 340, procs: 'D2393 #30 +1' },
  { number: 3561, patient: 'G. Morris', payer: 'metlife', status: 'pending', ageDays: 363, billed: 1210, procs: 'D2740 #3 +1', reason: 'payer reprocessing after lost claim', provider: 'Dr. Morgan' },
  { number: 4851, patient: 'I. Moreau', payer: 'cigna', status: 'rejected', ageDays: 2, billed: 395, procs: 'D0150 D0210 D1110', reason: 'subscriber ID', agent: { agent: 'claims', label: 'fix proposed · 84%' }, last: { at: at('2026-10-28', '07:02'), label: '277CA' } },
  { number: 4854, patient: 'Y. Haddad', payer: 'metlife', status: 'rejected', ageDays: 1, billed: 435, procs: 'D2392 #4 +1', reason: 'rendering NPI', queued: '10:45', agent: { agent: 'claims', label: 'NPI fixed · resend 10:45' }, last: { at: at('2026-10-28', '07:02'), label: 'resend' } },
  { number: 4772, patient: 'D. Foster', payer: 'cigna', status: 'partial', ageDays: 12, billed: 255, procs: 'D2392 #19', reason: 'underpaid $32 · PR-1', agent: { agent: 'posting', label: 'held from posting' }, last: { at: at('2026-10-28', '06:20'), label: 'ERA' } },
  { number: 4748, patient: 'L. Osei', payer: 'aetna', status: 'paid', ageDays: 8, billed: 255, procs: 'D2392 #14 DO', reason: 'alt. benefit D2140', agent: { agent: 'posting', label: 'pt. balance' }, last: { at: at('2026-10-27', '09:00'), label: 'ERA posted' } },
  { number: 4848, patient: 'R. Singh', payer: 'aetna', status: 'accepted', ageDays: 2, billed: 1020, procs: 'D2740 #14', agent: { agent: 'followup', label: 'status check 11/25' }, last: { at: at('2026-10-28', '09:58'), label: '277CA' } },
  // Today's claims (10/28), as the API seed builds them: Sent 5 · $1,320 and Ready 6 · $3,210 are all pinned.
  { number: 4857, patient: 'P. Okafor', payer: 'cigna', status: 'sent', ageDays: 0, billed: 230, procs: 'D0120 +3', built: '09:23', file: '09:45' },
  { number: 4864, patient: 'A. Russo', payer: 'metlife', status: 'sent', ageDays: 0, billed: 200, procs: 'D0120 +2', built: '09:23', file: '09:45', reason: 'D0274 will deny PR-frequency · acknowledgment on file 03/11' },
  { number: 4860, patient: 'H. Iqbal', payer: 'metlife', status: 'sent', ageDays: 0, billed: 395, procs: 'D0150 +2', built: '09:23', file: '10:15', a7Fixed: true, agent: { agent: 'claims', label: 'ID fixed · resent' } },
  { number: 4863, patient: 'J. Ortega', payer: 'cigna', status: 'sent', ageDays: 0, billed: 240, procs: 'D4341 LR', built: '09:53', file: '10:15', reason: 'LR only · UR not billable (no pocket depths charted)' },
  { number: 4866, patient: 'S. Brennan', payer: 'aetna', status: 'sent', ageDays: 0, billed: 255, procs: 'D2392 #3', built: '09:53', file: '10:15', reason: 'alternate benefit expected · pt est $71.60' },
  { number: 4855, patient: 'E. Novak', payer: 'delta_ny', status: 'ready', ageDays: 0, billed: 915, procs: 'D3320 #13', built: '10:21', file: '10:45', agent: { agent: 'claims', label: '10:45 file' } },
  { number: 4856, patient: 'B. Tran', payer: 'metlife', status: 'ready', ageDays: 0, billed: 395, procs: 'D0150 +2', built: '10:31', file: '10:45', agent: { agent: 'claims', label: '10:45 file' } },
  { number: 4859, patient: 'K. Owens', payer: 'delta_ny', status: 'ready', ageDays: 0, billed: 1240, procs: 'D2740 #30 +2', built: '10:38', file: '10:45', agent: { agent: 'claims', label: '10:45 file' }, last: { at: at('2026-10-28', '10:38'), label: '13 of 13 checks' } },
  {
    number: 4847, patient: 'F. Nwosu', payer: 'guardian', status: 'ready', ageDays: 1, billed: 200, procs: 'D0120 +2', reason: 'held',
    hold: { reason: 'other_documented', detail: 'No payer ID on file for the plan administrator (TPA)', held_since: at('2026-10-27', '11:24'), clears_when: 'TPA payer ID confirmed · paper claim 11/04 if none', owner_user_id: 'usr_dana', timely_due: '2027-01-25', cleared_at: null },
  },
  {
    number: 4842, patient: 'D. Akers', payer: 'guardian', status: 'ready', ageDays: 6, billed: 200, procs: 'D0120 +2', reason: 'held',
    hold: { reason: 'awaiting_primary_eob', detail: 'Secondary waits for Delta’s 835 on #4841 (accepted 10/23)', held_since: at('2026-10-22', '11:53'), clears_when: 'Delta 835 for #4841 posted', owner_user_id: 'usr_dana', timely_due: '2027-04-20', cleared_at: null },
  },
  {
    number: 4849, patient: 'L. Marsh', payer: 'aetna', status: 'ready', ageDays: 1, billed: 260, procs: 'D4910 +1', reason: 'held', provider: 'Dr. Lee',
    hold: { reason: 'note_unsigned', detail: 'Perio maintenance note not signed by the supervising dentist', held_since: at('2026-10-27', '16:10'), clears_when: 'Note signed in the PMS', owner_user_id: 'usr_lee', timely_due: '2027-04-25', cleared_at: null },
  },
  { number: 4801, patient: 'C. Ruiz', payer: 'metlife', status: 'appealed', ageDays: 58, billed: 960, procs: 'D4341 LL, LR', reason: 'reconsideration' },
  { number: 4688, patient: 'H. Lund', payer: 'cigna', status: 'appealed', ageDays: 71, billed: 320, procs: 'D2391 #20' },
  { number: 4702, patient: 'T. Varga', payer: 'guardian', status: 'appealed', ageDays: 44, billed: 640, procs: 'D3310 #9' },
]

/** Targets per status at Wed 10:40 (dollars). */
const TARGETS: Record<ClaimStatus, { count: number; dollars: number; age: [number, number] }> = {
  ready: { count: 6, dollars: 3210, age: [0, 0] },
  sent: { count: 5, dollars: 1320, age: [0, 1] },
  rejected: { count: 2, dollars: 830, age: [1, 3] },
  accepted: { count: 24, dollars: 17640, age: [1, 9] },
  pending: { count: 57, dollars: 46520, age: [10, 120] },
  denied: { count: 5, dollars: 6210, age: [5, 80] },
  appealed: { count: 3, dollars: 1920, age: [30, 90] },
  partial: { count: 5, dollars: 1060, age: [5, 40] },
  paid: { count: 118, dollars: 61300, age: [10, 40] },
}

function split(total: number, n: number, rand: () => number): number[] {
  if (n === 0) return []
  const w = Array.from({ length: n }, () => 0.35 + rand() * 1.3)
  const sw = w.reduce((a, b) => a + b, 0)
  const out = w.map((x) => Math.max(45, Math.round((total * x) / sw / 5) * 5))
  const diff = total - out.reduce((a, b) => a + b, 0)
  out[out.length - 1] = (out[out.length - 1] ?? 0) + diff
  return out
}

function lineFromProcs(id: string, procs: string, billedCents: number): ClaimLine[] {
  const code = /D\d{4}/.exec(procs)?.[0] ?? 'D0120'
  const tooth = /#(\d+)/.exec(procs)?.[1] ?? null
  const desc = PROCS.find((p) => p.cdt === code)?.desc ?? 'Procedure'
  return [{ id: `${id}_l1`, claim_id: id, cdt: code, description: desc, tooth, surface: null, fee_cents: billedCents, allowed_cents: null, paid_cents: null, adj: [], patient_adj: [], patient_cents: null }]
}

function genericTimeline(c: { id: string; status: ClaimStatus; dos: string; sentDate: string; payer: PayerKey }): TimelineEntry[] {
  const t: TimelineEntry[] = [
    { id: `${c.id}_t1`, at: at(c.dos, '10:43'), lane: 'agent', agent: 'claims', title: 'Built claim at checkout with PMS codes', tier: 1, evidence: [] },
  ]
  if (c.status !== 'ready') t.push({ id: `${c.id}_t2`, at: at(c.sentDate, '10:45'), lane: 'system', title: 'Left in the payer file via Vyne · 999 accepted', evidence: [] })
  if (!['ready', 'sent', 'rejected'].includes(c.status)) t.push({ id: `${c.id}_t3`, at: at(c.sentDate, '23:10'), lane: 'payer', title: 'Payer 277CA accepted · day-30 status check booked', evidence: [] })
  if (c.status === 'paid' || c.status === 'partial') t.push({ id: `${c.id}_t4`, at: at(daysAgo(2), '06:20'), lane: 'payer', title: c.status === 'paid' ? '835 posted on contract' : '835 posted · line held for review', evidence: [] })
  return t
}

function build(pin: Pin, idx: number, rand: () => number): MockClaim {
  const id = `clm_${pin.number}`
  const dos = daysAgo(pin.ageDays)
  const sentDate = dos
  const billed = pin.billed * 100
  const built = at(dos, pin.built ?? '10:43')
  const sentAt = pin.status === 'ready' ? null : at(sentDate, pin.file ?? '10:45')
  const icn = ['ready', 'sent', 'rejected'].includes(pin.status) ? null : `26${String(200 + (pin.number % 97)).padStart(3, '0')}-0${String(10000 + pin.number * 7).slice(-5)}`
  return {
    id,
    number: pin.number,
    visit_id: `vis_${pin.number}`,
    patient_id: `pat_${pin.patient.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}`,
    coverage_id: `cov_${pin.number}`,
    payer_key: pin.payer,
    status: pin.status,
    dos,
    built_at: built,
    sent_at: sentAt,
    file_time: pin.status === 'ready' && !pin.hold ? (pin.file ?? '10:45') : null,
    icn,
    ack_stage: ackStage(pin.status),
    billed_cents: billed,
    allowed_cents: pin.status === 'paid' || pin.status === 'partial' ? Math.round(billed * 0.78) : null,
    paid_cents: pin.status === 'paid' ? Math.round(billed * 0.62) : pin.status === 'partial' ? Math.round(billed * 0.45) : null,
    writeoff_cents: null,
    patient_resp_cents: null,
    denial: pin.denial ?? null,
    deadline: pin.deadline ?? { kind: 'timely_filing', due_on: daysAgo(pin.ageDays - 365), basis: 'payer timely filing · 12 months from DOS' },
    parent_claim_id: null,
    frequency_code: 1,
    readiness: ALL_PASS,
    timely_filing_due: daysAgo(pin.ageDays - 365),
    location_id: idx % 3 === 0 ? 'loc_riverside' : 'loc_downtown',
    patient: { id: `pat_${pin.number}`, name: pin.patient, dob: null },
    patient_name: pin.patient,
    provider_name: pin.provider ?? PROVIDERS[Math.floor(rand() * 2)] ?? 'Dr. Morgan',
    plan_label: null,
    age_days: pin.status === 'ready' ? null : pin.ageDays,
    procedures_label: pin.procs,
    reason_text: pin.reason ?? null,
    agent_chip: pin.agent ?? null,
    last_activity: pin.last ?? null,
    lines: lineFromProcs(id, pin.procs, billed),
    attachments: [],
    acks: pin.file ? todaysAcks(pin, id) : acksFor(pin.status, id, sentDate, icn),
    timeline: genericTimeline({ id, status: pin.status, dos, sentDate, payer: pin.payer }),
    in_flight: null,
    hold: pin.hold ? { id: `hld_${pin.number}`, subject: 'claim', subject_id: id, ...pin.hold } : null,
    queued_file: pin.queued ? { at: at(FROZEN_NOW.slice(0, 10), pin.queued), kind: 'original' } : null,
  }
}

/** A file today leaves at hh:mm: 999 a minute later, Vyne's 277CA four minutes later; the payer's 277CA overnight. */
function todaysAcks(pin: Pin, id: string): AckEvent[] {
  if (pin.status === 'ready' || !pin.file) return []
  const day = FROZEN_NOW.slice(0, 10)
  const plus = (m: number) => {
    const [h, mm] = (pin.file ?? '10:45').split(':').map(Number)
    const total = (h ?? 0) * 60 + (mm ?? 0) + m
    return at(day, `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
  }
  const out: AckEvent[] = [{ id: `${id}_ack1`, claim_id: id, stage: 'file_999_ok', code: null, message: 'File accepted (999)', at: plus(1) }]
  if (pin.a7Fixed) {
    out.unshift(
      { id: `${id}_ack0a`, claim_id: id, stage: 'file_999_ok', code: null, message: 'File accepted (999)', at: at(day, '09:46') },
      { id: `${id}_ack0b`, claim_id: id, stage: 'ch_277ca_a7', code: 'A7:164', message: 'Vyne 277CA rejected · subscriber id 8 digits, payer expects 9', at: at(day, '09:49') },
    )
  }
  out.push({ id: `${id}_ack2`, claim_id: id, stage: 'ch_277ca_a1', code: 'A1', message: 'Vyne 277CA accepted, forwarded to payer', at: plus(4) })
  return out
}

function generated(status: ClaimStatus, n: number, dollars: number, rand: () => number, startNumber: number): Pin[] {
  const amounts = split(dollars, n, rand)
  const [lo, hi] = TARGETS[status].age
  return amounts.map((billed, i) => {
    const proc = PROCS[Math.floor(rand() * PROCS.length)] ?? { cdt: 'D0120', desc: 'Periodic oral evaluation', tooth: false }
    const tooth = proc.tooth ? ` #${1 + Math.floor(rand() * 32)}` : ''
    return {
      number: startNumber + i,
      patient: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
      payer: PAYERS[Math.floor(rand() * PAYERS.length)] ?? 'delta_ny',
      status,
      ageDays: lo + Math.floor(rand() * (hi - lo + 1)),
      billed,
      procs: `${proc.cdt}${tooth}`,
    }
  })
}

/** #4821 is drawn in full: lines, attachments, acks, readiness, the owned root cause and its timeline. */
function owens4821(base: MockClaim): MockClaim {
  const evEra = { id: 'ev_4821_era', kind: 'era_line' as const, title: 'Delta 835 · 10/26 · D2740 #19', excerpt: 'CO-16 · N29 — claim lacks information needed for adjudication; N29: missing documentation (pre-operative radiograph required). Paid $0.00.', captured_at: at('2026-10-26', '06:05'), reference: 'TRN 1DD2629904' }
  const evRep = { id: 'ev_4821_rep', kind: 'rep_call' as const, title: 'Rep call (after IVR) · 6m 12s', excerpt: 'Rep, 10/27 4:20 PM: “…send the PA through FastAttach and resubmit with the claim number.”', captured_at: at('2026-10-27', '16:26'), reference: 'DD-1027-88412' }
  const evIvr = { id: 'ev_4821_ivr', kind: 'ivr_transcript' as const, title: 'Delta IVR status check', excerpt: '“Claim 26299-041833 … denied on October 26 … paid amount zero dollars.”', captured_at: at('2026-10-27', '16:02'), reference: 'IVR-1027-5531' }
  return {
    ...base,
    dos: '2026-10-12',
    built_at: at('2026-10-12', '10:43'),
    sent_at: at('2026-10-12', '10:45'),
    icn: '26299-041833',
    allowed_cents: 98600,
    paid_cents: 0,
    writeoff_cents: 25400,
    patient_resp_cents: 48200,
    denial: { carc: 'CO-16', rarc: 'N29', decoded: 'Claim lacks information: pre-operative radiograph required (N29: missing documentation).', root_cause: 'ours' },
    deadline: { kind: 'appeal', due_on: '2027-04-24', basis: 'Delta reconsideration window · 180 days from the 10/26 835' },
    patient: { id: 'pat_owens_k', name: 'K. Owens', dob: '1981-03-14' },
    patient_id: 'pat_owens_k',
    provider_name: 'Dr. Morgan',
    plan_label: 'Delta Dental PPO · subscriber: self',
    age_days: 16,
    location_id: 'loc_downtown',
    lines: [
      { id: 'cl_4821_1', claim_id: 'clm_4821', cdt: 'D2740', description: 'Crown, porcelain/ceramic', tooth: '19', surface: null, fee_cents: 109000, allowed_cents: 86800, paid_cents: 0, adj: [{ group: 'CO', code: '16', cents: 86800 }, { group: 'CO', code: '45', cents: 22200 }], patient_adj: [], patient_cents: 43400 },
      { id: 'cl_4821_2', claim_id: 'clm_4821', cdt: 'D2950', description: 'Core buildup', tooth: '19', surface: null, fee_cents: 12000, allowed_cents: 9600, paid_cents: 0, adj: [{ group: 'CO', code: '16', cents: 9600 }, { group: 'CO', code: '45', cents: 2400 }], patient_adj: [], patient_cents: 4800 },
      { id: 'cl_4821_3', claim_id: 'clm_4821', cdt: 'D0220', description: 'Intraoral periapical, first film', tooth: '19', surface: null, fee_cents: 3000, allowed_cents: 2200, paid_cents: 0, adj: [{ group: 'CO', code: '16', cents: 2200 }, { group: 'CO', code: '45', cents: 800 }], patient_adj: [], patient_cents: 0 },
    ],
    attachments: [
      { id: 'att_4821_1', claim_id: 'clm_4821', kind: 'narrative', nea_number: null, source: 'agent', created_at: at('2026-10-12', '10:43'), note: 'Narrative.txt' },
      { id: 'att_4821_2', claim_id: 'clm_4821', kind: 'bwx', nea_number: '47720913', source: 'agent', created_at: at('2026-10-12', '10:43'), note: 'sent 10/12 · wrong image for a crown' },
      { id: 'att_4821_3', claim_id: 'clm_4821', kind: 'eob', nea_number: null, source: 'agent', created_at: at('2026-10-26', '06:05'), note: 'Delta ERA 835 · 10/26' },
    ] satisfies Attachment[],
    acks: [
      { id: 'ack_4821_1', claim_id: 'clm_4821', stage: 'file_999_ok', code: null, message: '10:45 Delta file accepted (999)', at: at('2026-10-12', '10:46') },
      { id: 'ack_4821_2', claim_id: 'clm_4821', stage: 'ch_277ca_a1', code: 'A1', message: 'Vyne 277CA accepted, forwarded to Delta', at: at('2026-10-12', '11:02') },
      { id: 'ack_4821_3', claim_id: 'clm_4821', stage: 'payer_277ca_a1', code: 'A1', message: 'Delta accepted · ICN 26299-041833', at: at('2026-10-13', '06:12') },
    ],
    readiness: [
      { key: 'note_signed', status: 'pass', detail: 'Signed by Dr. Morgan 10/12 10:41' },
      { key: 'procs_match_note', status: 'pass', detail: 'D2740, D2950, D0220 on #19 match the note' },
      { key: 'fee_schedule', status: 'pass', detail: 'Practice fee schedule 2026' },
      { key: 'eligibility_fresh', status: 'pass', detail: 'Verified 10/10 · portal' },
      { key: 'remaining_max', status: 'pass', detail: '$1,180 remaining before this claim' },
      { key: 'attachment_rule', status: 'fail', detail: 'Delta D27xx needs a PA; a BWX was sent (rule fixed 10/26)' },
      { key: 'frequency', status: 'pass', detail: 'No crown on #19 in 5 years' },
      { key: 'timely_filing', status: 'pass', detail: 'Filed day 0 of 365' },
    ],
    timeline: [
      { id: 't4821_01', at: at('2026-10-12', '10:41'), lane: 'system', title: 'Crown D2740 #19 completed; 3 lines posted to the ledger (PMS)', evidence: [] },
      { id: 't4821_02', at: at('2026-10-12', '10:43'), lane: 'agent', agent: 'claims', tier: 1, title: 'Built claim at checkout with BWX D0274 (NEA# 47720913)', detail: 'The attachment rule picked the BWX, not the PA', evidence: [] },
      { id: 't4821_03', at: at('2026-10-12', '10:45'), lane: 'system', title: 'Left in the 10:45 Delta file via Vyne · 999 accepted', evidence: [] },
      { id: 't4821_04', at: at('2026-10-13', '06:12'), lane: 'payer', title: 'Delta 277CA accepted · ICN 26299-041833 · day-30 status check booked 11/11', evidence: [] },
      { id: 't4821_05', at: at('2026-10-26', '06:05'), lane: 'payer', title: 'Denied CO-16 · N29 · pre-op radiograph required', evidence: [evEra] },
      { id: 't4821_06', at: at('2026-10-26', '09:30'), lane: 'agent', agent: 'followup', root_cause: 'ours', title: 'Root cause: ours — BWX sent, not the PA billed as D0220', evidence: [] },
      { id: 't4821_07', at: at('2026-10-26', '10:02'), lane: 'human', actor: 'Dana S.', title: 'Approved rule: Delta D27xx → attach PA, not BWX · found 2 more', evidence: [] },
      { id: 't4821_08', at: at('2026-10-27', '16:02'), lane: 'agent', agent: 'followup', tier: 1, title: 'IVR status check: denied 10/26, $0 paid', evidence: [evIvr] },
      { id: 't4821_09', at: at('2026-10-27', '16:20'), lane: 'agent', agent: 'followup', tier: 1, title: 'Rep call · ref # DD-1027-88412: send PA via NEA, resubmit', evidence: [evRep] },
      { id: 't4821_10', at: at('2026-10-28', '06:15'), lane: 'agent', agent: 'followup', title: 'Matched PA #19 in PMS imaging; proposal → Inbox', evidence: [] },
    ],
  }
}

export function buildClaims(): MockClaim[] {
  const rand = mulberry32(4821)
  const pinsByStatus = new Map<ClaimStatus, Pin[]>()
  for (const p of PINS) pinsByStatus.set(p.status, [...(pinsByStatus.get(p.status) ?? []), p])
  const all: Pin[] = [...PINS]
  let next = 3600
  for (const [status, t] of Object.entries(TARGETS) as [ClaimStatus, (typeof TARGETS)[ClaimStatus]][]) {
    const pins = pinsByStatus.get(status) ?? []
    const remaining = t.count - pins.length
    const dollars = t.dollars - pins.reduce((a, p) => a + p.billed, 0)
    const gen = generated(status, remaining, dollars, rand, next)
    next += remaining + 7
    all.push(...gen)
  }
  return all.map((pin, i) => {
    const c = build(pin, i, rand)
    return c.number === 4821 ? owens4821(c) : c
  })
}
