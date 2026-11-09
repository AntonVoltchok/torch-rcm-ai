/**
 * D1's server values for the mock API, ported from the API so MSW mode reads like the real server:
 * whose move (`readmodels/moves.py`), the approval in words (`agents/catalog/phrases.py` + recipe effects,
 * `readmodels/wording.py`) and "What changed" (`readmodels/changes.py`). The browser never runs this; the mock
 * server does. `parity.test.ts` holds it to `fixtures/parity.json`, which the API regenerates and checks
 * (`apps/api/tests/test_mock_parity.py`), so a rule changed on one side fails a test on the other.
 */
import type { ClaimMove, ClaimOutcome, ClaimStatus, Confidence, HolderCount, InboxWaitingGroup, Learnable, MoveCount, MoveWho, Role, StripChange } from '@/api/schema'
import type { MockClaim } from './fixtures/claims'
import type { MockInboxItem } from './fixtures/inbox'

export type UserId = 'usr_dana' | 'usr_morgan' | 'usr_lee' | 'usr_tasha'
export const USER_NAME: Record<UserId, string> = { usr_dana: 'Dana S.', usr_morgan: 'Dr. Morgan', usr_lee: 'Dr. Lee', usr_tasha: 'Tasha P.' }
export const USER_ROLE: Record<UserId, Role> = { usr_dana: 'billing', usr_morgan: 'owner', usr_lee: 'dentist', usr_tasha: 'front_desk' }
const USERS = Object.keys(USER_NAME) as UserId[]
export const MOVE_WHO: readonly MoveWho[] = ['practice', 'agents', 'payer', 'nobody']
const OPEN: readonly ClaimStatus[] = ['ready', 'sent', 'rejected', 'accepted', 'pending', 'denied', 'appealed', 'partial']
const TIER3_APPROVERS: Record<string, Role[]> = { write_off: ['owner'], formal_appeal: ['dentist', 'owner'], void_claim: ['owner'] }
const ROLE_WORD: Record<Role, string> = { owner: 'the owner', billing: 'billing', dentist: 'the dentist', front_desk: 'the front desk' }
const HOLD_HOLDER: Record<string, [MoveWho, Role | null]> = {
  note_unsigned: ['practice', 'dentist'],
  procs_not_in_note: ['practice', 'dentist'],
  rendering_mismatch: ['practice', 'dentist'],
  missing_image: ['practice', 'billing'],
  subscriber_id_invalid: ['practice', 'billing'],
  other_documented: ['practice', 'billing'],
  awaiting_primary_eob: ['payer', null],
  reprocessing_requested: ['payer', null],
}
export const FILING_ACTIONS = new Set([
  'resubmit_with_attachment', 'reprocessing_request', 'records_request', 'formal_appeal', 'corrected_claim',
  'send_claim_pms_codes', 'send_claim_agent_text', 'fix_demographics_resend', 'cob_order_change',
])
const PAYER_REQUESTS = new Set(['reprocessing_request', 'records_request'])
const PAYER_ACKS = new Set(['payer_277ca_a1', 'payer_277ca_a7'])
const NO_REPLY_BUSINESS_DAYS = 2

// ── whose move ───────────────────────────────────────────────────────────────────────────────────────────

export function approverRoles(item: MockInboxItem): Role[] | null {
  if (item.kind === 'owner_signoff') return ['owner']
  if (item.tier === 3) return TIER3_APPROVERS[item.proposed_action?.action ?? ''] ?? ['owner']
  return null
}

export function canApprove(user: UserId | null, item: MockInboxItem): boolean {
  if (!user) return false
  const roles = approverRoles(item)
  if (roles && !roles.includes(USER_ROLE[user])) return false
  if (roles && item.assignee_user_id && item.assignee_user_id !== user) return USER_ROLE[user] === 'owner'
  return true
}

export function sees(user: UserId, item: MockInboxItem): boolean {
  const role = USER_ROLE[user]
  const mine = item.assignee_user_id === user
  const shared = !item.assignee_user_id
  if (role === 'billing' || role === 'owner') return shared || mine
  if (role === 'front_desk') return mine || (shared && item.kind === 'eligibility_flag')
  return mine
}

const canAct = (user: UserId | null, item: MockInboxItem) => user !== null && sees(user, item) && canApprove(user, item)

/**
 * The API's `claims.split_inbox`: what the viewer can act on ("N items need you"), and the rest by who can, each
 * row naming the users who have it in their own count. Users in id order, rows in first-seen order.
 */
export function splitInbox(items: readonly MockInboxItem[], viewer: UserId): { yours: MockInboxItem[]; waiting: InboxWaitingGroup[] } {
  const yours: MockInboxItem[] = []
  const rows = new Map<string, InboxWaitingGroup>()
  const ids = [...USERS].sort()
  for (const item of items) {
    if (canAct(viewer, item)) {
      yours.push(item)
      continue
    }
    const signers = ids.filter((u) => canAct(u, item))
    const key = signers.join(',')
    const row = rows.get(key) ?? { signer_ids: signers, label: signers.map((u) => USER_NAME[u]).join(' or ') || 'the owner', count: 0, cents: 0, item_ids: [] }
    rows.set(key, row)
    row.count++
    row.cents += item.cents
    row.item_ids.push(item.id)
  }
  return { yours, waiting: [...rows.values()] }
}
const holderRole = (item: MockInboxItem): Role => item.required_role ?? approverRoles(item)?.[0] ?? 'billing'
const sole = (role: Role) => {
  const holders = USERS.filter((u) => USER_ROLE[u] === role)
  return holders.length === 1 ? holders[0] : null
}

function practiceLabel(role: Role, userId: string | null | undefined, signs: boolean): string {
  const user = (userId && userId in USER_NAME ? (userId as UserId) : null) ?? (signs ? sole(role) : null)
  if (signs) return user ? `${USER_NAME[user]} signs` : `${ROLE_WORD[role][0]?.toUpperCase()}${ROLE_WORD[role].slice(1)} signs`
  return `Waiting on ${user ? USER_NAME[user] : ROLE_WORD[role]}`
}

const tierOf = (i: MockInboxItem) => i.tier ?? 0
function holderItem(items: MockInboxItem[], viewer: UserId | null): MockInboxItem {
  const ordered = [...items].sort((a, b) => tierOf(b) - tierOf(a) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  return ordered.find((i) => canAct(viewer, i)) ?? (ordered[0] as MockInboxItem)
}

const clockOf = (iso: string) => {
  const [h, m] = iso.slice(11, 16).split(':').map(Number) as [number, number]
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const mmdd = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}`
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export function businessDays(start: string, end: string): number {
  let n = 0
  for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) if (weekday(d) % 6 !== 0) n++
  return n
}

export interface MoveFacts {
  claim: MockClaim
  /** Open items on the claim (the item being approved left out, for `lands`). */
  items: MockInboxItem[]
  /** Queued, running or paused runs on the claim (the run being measured left out, for `claim_outcome`). */
  activeRuns: { status: string }[]
  viewer: UserId | null
  now: string
  payerShort: string
  sendRuleAuto: boolean
  /** Something was filed for the payer after its last remittance (the API's `filed_since_remit`). */
  filedSinceRemit: boolean
}

export function claimMove(f: MoveFacts): ClaimMove {
  const { claim, viewer } = f
  const move = (who: MoveWho, label: string, role: Role | null = null, userId: string | null = null, mine = false): ClaimMove => ({ who, holder_role: role, holder_user_id: userId, mine, label })
  const billing = viewer !== null && ['billing', 'owner'].includes(USER_ROLE[viewer])
  if (claim.closed_reason) return move('nobody', 'Closed')
  if (f.activeRuns.length) return move('agents', f.activeRuns.every((r) => r.status === 'paused') ? 'Agents paused' : 'With the agents')
  if (f.items.length) {
    const item = holderItem(f.items, viewer)
    const role = holderRole(item)
    const userId = item.assignee_user_id ?? null
    return move('practice', practiceLabel(role, userId, approverRoles(item) !== null), role, userId, canAct(viewer, item))
  }
  const hold = claim.hold && !claim.hold.cleared_at ? claim.hold : null
  if (hold) {
    const [who, role] = HOLD_HOLDER[hold.reason] ?? ['practice', 'billing']
    if (who === 'payer' || !role) return move('payer', hold.reason === 'awaiting_primary_eob' ? "Waiting on the primary payer's EOB" : `Waiting on ${f.payerShort}`)
    const userId = hold.owner_user_id ?? null
    const mine = viewer !== null && (userId ? viewer === userId : [role, 'owner'].includes(USER_ROLE[viewer]))
    return move(who, practiceLabel(role, userId, false), role, userId, mine)
  }
  if (claim.queued_file) return move('agents', `In the ${clockOf(claim.queued_file.at)} ${f.payerShort} file`)
  switch (claim.status) {
    case 'paid':
      return move('nobody', 'Finished')
    case 'ready':
      return f.sendRuleAuto ? move('agents', 'With the agents') : move('practice', 'Ready to send', 'billing', null, billing)
    case 'sent': {
      const sent = claim.sent_at?.slice(0, 10) ?? f.now.slice(0, 10)
      if (!PAYER_ACKS.has(claim.ack_stage) && businessDays(sent, f.now.slice(0, 10)) > NO_REPLY_BUSINESS_DAYS) {
        return move('practice', `No reply from ${f.payerShort} since ${mmdd(sent)}`, 'billing', null, billing)
      }
      return move('payer', `Sent ${mmdd(sent)}, no reply yet`)
    }
    case 'rejected':
      return move('practice', 'Rejected, not resent', 'billing', null, billing)
    case 'denied':
    case 'partial':
      if (!claim.in_flight && !f.filedSinceRemit) return move('practice', `${claim.status === 'denied' ? 'Denied' : 'Underpaid'}, nothing filed`, 'billing', null, billing)
      return move('payer', `Waiting on ${f.payerShort}`)
    default:
      return move('payer', `Waiting on ${f.payerShort}`)
  }
}

export function byHolder(moves: ClaimMove[]): HolderCount[] {
  const counts = new Map<string, HolderCount>()
  for (const m of moves) {
    const key = [m.who, m.holder_role ?? '', m.holder_user_id ?? '', m.mine].join('|')
    const row = counts.get(key) ?? { who: m.who, holder_role: m.holder_role, holder_user_id: m.holder_user_id, mine: m.mine, count: 0 }
    row.count++
    counts.set(key, row)
  }
  return [...counts.values()].sort(
    (a, b) =>
      MOVE_WHO.indexOf(a.who) - MOVE_WHO.indexOf(b.who) ||
      Number(!a.mine) - Number(!b.mine) ||
      (a.holder_role ?? '').localeCompare(b.holder_role ?? '') ||
      (a.holder_user_id ?? '').localeCompare(b.holder_user_id ?? ''),
  )
}

export function moveCounts(open: MockClaim[], moveOf: (c: MockClaim) => ClaimMove): MoveCount[] {
  return MOVE_WHO.map((who) => {
    const rows = open.filter((c) => moveOf(c).who === who)
    const by_status = OPEN.flatMap((status) => {
      const count = rows.filter((c) => c.status === status).length
      return count ? [{ status, count }] : []
    })
    return { who, count: rows.length, cents: rows.reduce((a, c) => a + c.billed_cents, 0), by_status }
  })
}

export function claimOutcome(before: [ClaimStatus, MoveWho] | null, after: [ClaimStatus, MoveWho] | null): ClaimOutcome | null {
  if (!after) return null
  const b = before ?? after
  return { status_from: b[0], status_to: after[0], move_from: b[1], move_to: after[1] }
}

// ── the approval in words ────────────────────────────────────────────────────────────────────────────────

type Params = Record<string, unknown>
const FILE_TIMES = Array.from({ length: 22 }, (_, i) => {
  const m = 7 * 60 + 45 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}) // every payer's file times in the seed, as the API's Payer.file_times
const EDIT_LOCK_MIN = 1
const NEA_LEAD_MIN = 30
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The API's `predicted_file_time`: '11:15', or 'Thu 07:45' when today's files are gone. */
export function predictedFileTime(now: string, leadMin: number): string {
  const today = now.slice(0, 10)
  const [h, m] = now.slice(11, 16).split(':').map(Number) as [number, number]
  const earliest = h * 60 + m + Math.max(leadMin, EDIT_LOCK_MIN)
  for (let d = 0; d < 8; d++) {
    const day = addDays(today, d)
    if (weekday(day) % 6 === 0) continue
    const t = FILE_TIMES.find((x) => d > 0 || Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) > earliest)
    if (t) return d === 0 ? t : `${DAY[weekday(day)]} ${t}`
  }
  return 'next'
}
const clock = (hhmm: string) => {
  const [day, t] = hhmm.includes(' ') ? hhmm.split(' ') : ['', hhmm]
  if (!t?.includes(':')) return hhmm
  const label = clockOf(`0000-00-00T${t}`)
  return day ? `${day} ${label}` : label
}
const fileLabel = (payer: string, now: string, lead: number) => {
  const t = predictedFileTime(now, lead)
  return t === 'next' ? `the next ${payer} file` : `the ${clock(t)} ${payer} file`
}

export function dollars(cents: unknown): string {
  const v = typeof cents === 'number' ? cents : 0
  const whole = Math.floor(v / 100)
  const part = v % 100
  return part === 0 ? `$${whole.toLocaleString('en-US')}` : `$${whole.toLocaleString('en-US')}.${String(part).padStart(2, '0')}`
}

const ATTACHMENT_WORD: Record<string, string> = { pa: 'x-ray', bwx: 'x-ray', fmx: 'x-ray series', perio_chart: 'perio chart', narrative: 'narrative' }
const FIELD_WORD: Record<string, string> = { subscriber_id: 'Subscriber ID', group_no: 'Group number', patient_dob: 'Date of birth', rendering_npi: 'Rendering NPI' }
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)
const pluralOf = (w: string) => (w.endsWith('series') ? w : `${w}s`)

export interface WordsCtx {
  params: Params
  payer: string
  now: string
  n: number
  drafted: boolean
  enclosures: string[]
}

const PHRASES: Record<string, (c: WordsCtx) => string> = {
  status_check: (c) => `Check status with ${c.payer}`,
  payer_rep_call: (c) => `Call ${c.payer}`,
  records_request: (c) => `Send records to ${c.payer}`,
  resubmit_with_attachment: (c) => {
    const w = ATTACHMENT_WORD[String(c.params.attachment_kind)] ?? 'attachment'
    return `Send ${plural(c.n, w, pluralOf(w))} and resubmit`
  },
  reprocessing_request: (c) => (c.drafted ? `Send this note to ${c.payer}` : c.params.basis === 'ny_prompt_pay' ? 'Send prompt-pay request' : `Ask ${c.payer} to reprocess`),
  request_835: (c) => `Ask ${c.payer} for the 835`,
  send_claim_pms_codes: (c) => `Send ${plural(c.n, 'claim', 'claims')}`,
  fix_demographics_resend: (c) => (c.params.field === 'subscriber_id' ? 'Update ID and resend' : `Update ${(FIELD_WORD[String(c.params.field)] ?? 'field').toLowerCase()} and resend`),
  eligibility_check: () => 'Check eligibility',
  post_era_line: (c) =>
    followUp('post_era_line', c.params)?.[0] === 'reprocessing_request' && c.params.disputed_cents
      ? `Post ${c.payer}'s payment, ask ${c.payer} to reprocess ${dollars(c.params.disputed_cents)}`
      : c.params.post === 'patient_share_only' && c.params.disputed_cents
      ? `Post ${c.payer}'s payment, dispute ${dollars(c.params.disputed_cents)}`
      : c.params.post === 'patient_share_only'
        ? 'Post the patient share'
        : `Post ${c.payer}'s payment`,
  update_pms_benefits: () => 'Update benefits in the PMS',
  send_claim_agent_text: () => 'Send claim with the reviewed narrative',
  corrected_claim: () => 'Send a corrected claim',
  patient_transfer: (c) => `Move ${dollars(c.params.cents)} to patient`,
  send_statement: () => 'Send statement',
  mechanical_refund: (c) => `Refund ${dollars(c.params.cents)}`,
  cob_order_change: () => 'Change coverage order and resubmit',
  write_off: (c) => `Sign ${dollars(c.params.writeoff_cents)} write-off${c.params.patient_transfer_cents ? `, ${dollars(c.params.patient_transfer_cents)} to patient` : ''}`,
  formal_appeal: () => 'Sign formal appeal',
  void_claim: () => 'Sign claim void',
  discretionary_refund: (c) => `Sign ${dollars(c.params.cents)} refund`,
  collections_referral: () => 'Sign collections referral',
  waiver: (c) => `Sign ${dollars(c.params.cents)} waiver`,
  hold_claim: () => 'Hold claim',
}

/** One effect: counted ([one, many]) or shown as written (string). */
type Touch = [string, string] | string
const queued = (c: WordsCtx, lead: number): Touch => [`claim in ${fileLabel(c.payer, c.now, lead)}`, `claims in ${fileLabel(c.payer, c.now, lead)}`]
const counted = (w: string, rest: string): Touch => [`${w} ${rest}`, `${pluralOf(w)} ${rest}`]

/** Each recipe's step effects, in step order (the API's `RecipeStep.effect`). */
const EFFECTS: Record<string, (c: WordsCtx) => Touch[]> = {
  resubmit_with_attachment: (c) => [counted(ATTACHMENT_WORD[String(c.params.attachment_kind)] ?? 'attachment', 'uploaded to NEA'), queued(c, NEA_LEAD_MIN)],
  records_request: (c) => [['records packet uploaded to NEA', 'records packets uploaded to NEA'], [`set of records sent to ${c.payer}`, `sets of records sent to ${c.payer}`]],
  status_check: (c) => [[`status check with ${c.payer}`, `status checks with ${c.payer}`]],
  payer_rep_call: (c) => [[`call to ${c.payer} provider services`, `calls to ${c.payer} provider services`]],
  reprocessing_request: (c) => [
    counted(c.drafted ? 'note' : c.params.basis === 'ny_prompt_pay' ? 'prompt-pay request' : 'reprocessing request', `sent to ${c.payer}`),
    ...c.enclosures.map((t) => `${t} enclosed`),
  ],
  request_835: (c) => [`835 requested from ${c.payer}`],
  send_claim_pms_codes: (c) => [queued(c, EDIT_LOCK_MIN)],
  fix_demographics_resend: (c) => [`${FIELD_WORD[String(c.params.field)] ?? 'Field'} on this claim changed`, queued(c, EDIT_LOCK_MIN)],
  eligibility_check: (c) => [[`benefits check with ${c.payer}`, `benefits checks with ${c.payer}`]],
  post_era_line: (c) => {
    if (c.params.post !== 'patient_share_only') return [[`${c.payer} payment posted to the PMS ledger`, `${c.payer} payments posted to the PMS ledger`]]
    const out: Touch[] = [`${c.payer} payment posted, patient share only`]
    if (c.params.patient_cents) out.push(`${dollars(c.params.patient_cents)} moved to patient balance`)
    if (c.params.disputed_cents) out.push(`${dollars(c.params.disputed_cents)} held as disputed`)
    return out
  },
  update_pms_benefits: () => ['Benefits updated in the PMS'],
  send_claim_agent_text: (c) => ['Reviewed narrative added to the claim', queued(c, EDIT_LOCK_MIN)],
  corrected_claim: () => [['corrected claim queued', 'corrected claims queued']],
  patient_transfer: (c) => [`${dollars(c.params.cents)} moved to patient balance`],
  send_statement: () => [['statement sent to the patient', 'statements sent to patients']],
  mechanical_refund: (c) => [`${dollars(c.params.cents)} refunded to the original payment method`],
  cob_order_change: (c) => ['Coverage order changed in the PMS', queued(c, EDIT_LOCK_MIN)],
  hold_claim: () => [],
}
const LEFT_TO_POST: Record<string, (c: WordsCtx) => string[]> = {
  write_off: (c) => [`${dollars(c.params.writeoff_cents)} write-off to post in the PMS`, ...(c.params.patient_transfer_cents ? [`${dollars(c.params.patient_transfer_cents)} to move to patient balance`] : [])],
  formal_appeal: (c) => [`Signed appeal to send to ${c.payer}`],
  void_claim: (c) => [`Void to file with ${c.payer}`],
  discretionary_refund: (c) => [`${dollars(c.params.cents)} refund to issue`],
  collections_referral: () => ['Referral to make'],
  waiver: (c) => [`${dollars(c.params.cents)} waiver to post`],
}
const REVERSES: Record<string, 'until_file_leaves' | 'until_day_close' | 'void_only'> = {
  resubmit_with_attachment: 'until_file_leaves', send_claim_pms_codes: 'until_file_leaves', fix_demographics_resend: 'until_file_leaves',
  send_claim_agent_text: 'until_file_leaves', post_era_line: 'until_day_close', patient_transfer: 'until_day_close', corrected_claim: 'void_only',
}
const CONTACTS_PAYER = new Set(['status_check', 'payer_rep_call', 'records_request', 'resubmit_with_attachment', 'reprocessing_request', 'request_835', 'eligibility_check'])

function reversibility(action: string, c: WordsCtx): string | null {
  const r = REVERSES[action]
  if (r === 'until_file_leaves') {
    const t = predictedFileTime(c.now, action === 'resubmit_with_attachment' ? NEA_LEAD_MIN : EDIT_LOCK_MIN)
    return t === 'next' ? 'Can be pulled until the file leaves' : `Can be pulled from the file until ${clock(t)}`
  }
  if (r === 'until_day_close') return 'Can be undone until day close'
  if (r === 'void_only') return 'Can only be voided once sent'
  return CONTACTS_PAYER.has(action) ? 'Cannot be recalled once sent' : null
}

export const ELIGIBILITY_LABEL = 'Note it for the front desk'
export const SIGNOFF_LABEL = 'Sign the rule change'

export function phrase(action: string, c: WordsCtx): string {
  return PHRASES[action]?.(c) ?? action.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase())
}

export function touches(action: string, members: WordsCtx[]): string[] {
  const first = members[0]
  if (!first) return []
  if (LEFT_TO_POST[action]) {
    const lines = ['Signed decision recorded on the claim']
    for (const m of members) for (const t of LEFT_TO_POST[action]?.(m) ?? []) if (!lines.includes(t)) lines.push(t)
    return lines
  }
  const seen = new Map<string, [Touch, number]>()
  for (const m of members) {
    for (const t of EFFECTS[action]?.(m) ?? []) {
      const key = typeof t === 'string' ? t : t[0]
      seen.set(key, [t, (seen.get(key)?.[1] ?? 0) + 1])
    }
  }
  const out = [...seen.values()].map(([t, n]) => (typeof t === 'string' ? t[0]?.toUpperCase() + t.slice(1) : `${n} ${n === 1 ? t[0] : t[1]}`))
  const back = reversibility(action, first)
  const lines = back ? [...out, back] : out
  const next = followUp(action, first.params) // what the post's `then` queues runs in the same approval
  if (next && EFFECTS[next[0]]) {
    const then = members.flatMap((m) => {
      const f = followUp(action, m.params)
      return f ? [{ ...m, params: f[1], drafted: false, enclosures: [] }] : []
    })
    for (const t of touches(next[0], then)) if (!lines.includes(t)) lines.push(t)
  }
  return lines
}

const FOLLOW_UP_ARG: Record<string, string> = { reprocessing_request: 'basis' }

/** The action an ERA post's `then` queues and its params (the API's `catalog.actions.follow_up`). */
export function followUp(action: string, params: Record<string, unknown>): [string, Record<string, unknown>] | null {
  const then = action === 'post_era_line' ? params.then : null
  if (typeof then !== 'string' || !then) return null
  const [name = '', arg] = then.split(':', 2)
  const out: Record<string, unknown> = typeof params.claim_id === 'string' ? { claim_id: params.claim_id } : {}
  const key = FOLLOW_UP_ARG[name]
  if (arg && key) out[key] = arg
  return [name, out]
}

const SIGNER_WHY: Record<string, string> = {
  write_off: 'Writing off money commits the practice',
  formal_appeal: "A formal appeal goes out over the dentist's signature",
  void_claim: 'Voiding a claim commits the practice',
  discretionary_refund: 'A refund the practice chooses to give commits it',
  collections_referral: 'Sending a patient to collections commits the practice',
  waiver: 'Waiving a balance commits the practice',
}

export function signerNote(item: MockInboxItem, viewer: UserId | null): string | null {
  const roles = approverRoles(item)
  if (!roles || canApprove(viewer, item)) return null
  const names = USERS.filter((u) => roles.includes(USER_ROLE[u]))
    .sort((a, b) => roles.indexOf(USER_ROLE[a]) - roles.indexOf(USER_ROLE[b]) || a.localeCompare(b))
    .map((u) => USER_NAME[u])
  const who = names.length ? names.join(' or ') : 'the owner'
  const why = SIGNER_WHY[item.proposed_action?.action ?? ''] ?? (item.tier !== 3 ? "A rule change needs the owner's signature" : '')
  return why ? `${why}, so only ${who} can sign this.` : `Only ${who} can sign this.`
}

/** Where the claim's move goes once the approval has run (the API's `wording.lands`). */
export function lands(item: MockInboxItem, resolvedMove: () => ClaimMove): MoveWho | null {
  if (!item.claim_id) return null
  const posted = item.proposed_action?.action
  const action = (posted && followUp(posted, item.proposed_action?.params ?? {})?.[0]) || posted
  if (action && item.tier !== 3) {
    if (PAYER_REQUESTS.has(action)) return 'payer'
    if (FILING_ACTIONS.has(action)) return 'agents'
  }
  return resolvedMove().who
}

// ── what changed ─────────────────────────────────────────────────────────────────────────────────────────

/** The strip numbers a change row reads. */
interface StripNumbers {
  inbox_open: number
  inbox_claims: number
  tiles: { status: ClaimStatus; count: number; label: string }[]
}

export function stripChanges(before: StripNumbers, after: StripNumbers, touched: ClaimStatus[], note: (s: ClaimStatus) => string | null): StripChange[] {
  const rows: StripChange[] = [
    { key: 'inbox', label: 'Your Inbox', before: before.inbox_open, after: after.inbox_open, note: null },
    { key: 'inbox_claims', label: 'Claims in your Inbox', before: before.inbox_claims, after: after.inbox_claims, note: null },
  ]
  for (const t of after.tiles) {
    if (!touched.includes(t.status)) continue
    const b = before.tiles.find((x) => x.status === t.status)?.count ?? 0
    rows.push({ key: `tile.${t.status}`, label: t.label, before: b, after: t.count, note: b === t.count ? note(t.status) : null })
  }
  return rows
}

export function changeNote(status: ClaimStatus, actions: string[], payers: string[]): string | null {
  const payer = new Set(payers).size === 1 ? (payers[0] as string) : 'the payer'
  if (actions.length && actions.every((a) => FILING_ACTIONS.has(a) && !['reprocessing_request', 'records_request', 'formal_appeal'].includes(a))) {
    return `Stays ${status} until ${payer} processes the resubmission`
  }
  if (actions.length && actions.every((a) => FILING_ACTIONS.has(a))) return `Stays ${status} until ${payer} replies`
  return null
}

// ── plain procedure names (the API's world/fees.py PLAIN) ────────────────────────────────────────────────

const PLAIN: Record<string, string> = {
  D0120: 'Periodic exam', D0140: 'Limited exam', D0150: 'Comprehensive exam', D0210: 'Full-mouth x-rays', D0220: 'PA x-ray',
  D0230: 'PA x-ray, additional', D0272: 'Bitewings, two', D0274: 'Bitewings, four', D0330: 'Panoramic x-ray', D1110: 'Adult cleaning',
  D1120: 'Child cleaning', D1206: 'Fluoride varnish', D1208: 'Fluoride', D1351: 'Sealant', D2140: 'Amalgam, one surface',
  D2150: 'Amalgam, two surfaces', D2391: 'Composite, one surface', D2392: 'Composite, two surfaces', D2393: 'Composite, three surfaces',
  D2394: 'Composite, four+ surfaces', D2740: 'Crown', D2750: 'Crown, PFM', D2950: 'Core buildup', D2954: 'Post and core',
  D3310: 'Root canal, anterior', D3320: 'Root canal, premolar', D3330: 'Root canal, molar', D4341: 'Scaling and root planing, 4+ teeth',
  D4342: 'Scaling and root planing, 1-3 teeth', D4910: 'Perio maintenance', D6010: 'Implant', D6057: 'Custom abutment',
  D6065: 'Implant crown', D6240: 'Bridge pontic', D6750: 'Bridge retainer crown', D7140: 'Extraction', D7210: 'Surgical extraction',
  D9110: 'Palliative treatment', D9941: 'Athletic mouthguard', D9944: 'Night guard', D9972: 'Whitening, per arch',
}

export function plainProcedures(lines: { cdt: string; tooth?: string | null }[]): string {
  const first = lines[0]
  if (!first) return ''
  const head = `${first.cdt} ${PLAIN[first.cdt] ?? ''}`.trim() + (first.tooth ? `, tooth ${first.tooth}` : '')
  return lines.length > 1 ? `${head} + ${lines.length - 1} more` : head
}

// ── track record (the API's domain/values.py `track_record`) ─────────────────────────────────────────────

const MIN_BASE_RATE_N = 5
const METRIC_PHRASE: Record<string, string> = { paid_30d: 'paid within 30 days', accepted: 'accepted', balanced: 'balanced' }

export function metricPhrase(metric: string | null | undefined): string {
  return METRIC_PHRASE[metric ?? ''] ?? 'succeeded'
}

export function trackRecord(k: number, n: number, outcome: string): Confidence {
  if (n === 0) return { pct: null, k: 0, n: 0, outcome, basis: 'No past cases like this yet.' }
  if (n < MIN_BASE_RATE_N) {
    return { pct: null, k, n, outcome, basis: `Only ${n} past ${n === 1 ? 'case' : 'cases'} like this, too few for a track record yet.` }
  }
  return { pct: Math.round((100 * k) / n), k, n, outcome, basis: `${k} of ${n} ${outcome}` }
}

// ── could this rule learn? (the API's agents/policy.py `learnable`) ─────────────────────────────────────

export const ROOT_CAUSE_OURS_REASON =
  'Root cause: ours. Fix where it starts (charting, coding or front desk); this kind always gets a review.'

interface LearnRule {
  label: string
  outcome_metric?: string | null
  base_rate?: { n: number; k: number } | null
}

/** Same order as the API: tier 3, agent-written text, tier 2, no rule, root cause ours, no metric, too few cases. */
/** The API's `policy.UNNAMED_*`: a situation the classifier couldn't name has no track record of its own. */
export const UNKNOWN = 'unknown'
export const UNNAMED_BASIS = "No track record. TorchRCM couldn't match this to a known situation, so there are no past cases to compare."
export const UNNAMED_LEARN_REASON = "TorchRCM couldn't match this to a known situation, so there are no past cases to learn from."
export const unnamedConfidence = (outcome: string): Confidence => ({ pct: null, k: 0, n: 0, outcome, basis: UNNAMED_BASIS })

export function learnable(item: MockInboxItem, rule: LearnRule | undefined, causes: (string | null | undefined)[]): Learnable {
  const no = (code: NonNullable<Learnable['code']>, reason: string): Learnable => ({ ok: false, code, reason })
  if (item.tier === 3) return no('tier_not_learnable', 'A person always does this one. It never runs on its own.')
  if (item.kind === 'review_draft') return no('tier_not_learnable', 'The agents wrote this text, so a person reads it before it goes out.')
  if (item.tier === 2) return no('tier_not_learnable', "The owner sets this rule. It isn't learned from approvals.")
  if (item.tier == null || !rule) return no('tier_not_learnable', 'No rule covers this, so a person decides each time.')
  if (causes.includes('ours')) return no('root_cause_guard', ROOT_CAUSE_OURS_REASON)
  if (item.situation === UNKNOWN) return no('not_enough_evidence', UNNAMED_LEARN_REASON)
  if (!rule.outcome_metric || rule.outcome_metric === 'none') {
    return no('tier_not_learnable', `“${rule.label}” has no outcome to measure, so it is never learned.`)
  }
  const n = rule.base_rate?.n ?? 0
  if (n < MIN_BASE_RATE_N) return no('not_enough_evidence', `Only ${n} past ${n === 1 ? 'case' : 'cases'} like this, too few to learn from yet.`)
  return { ok: true, code: null, reason: 'You can propose running this without review. Nothing changes until the proposal is accepted.' }
}

// ── headline (the API's readmodels/headline.py) ──────────────────────────────────────────────────────────

export interface HeadlineFacts {
  payer: string
  procedure: string
  days: number | null
  params: Record<string, unknown>
  /** Claims in the batch the sentence speaks for (1 for an item). */
  n?: number
}

/** 'this crown', or 'these 3 crowns' for a batch. */
function subject(f: HeadlineFacts): string {
  const n = f.n ?? 1
  if (n === 1) return `this ${f.procedure}`
  return `these ${n} ${f.procedure.endsWith('s') ? f.procedure : `${f.procedure}s`}`
}

/** 'Crown, PFM' → 'crown'; 'PA x-ray' keeps its capitals. */
export function procedureNoun(cdt: string | null | undefined): string {
  const name = (PLAIN[cdt ?? ''] ?? '').split(',')[0]?.trim() ?? ''
  if (!name) return 'claim'
  const second = name.charAt(1)
  return second && second !== second.toLowerCase() ? name : name.charAt(0).toLowerCase() + name.slice(1)
}

const SENTENCES: Record<string, (f: HeadlineFacts) => string> = {
  'denied:CO-16:N29:pa_missing': (f) => `${f.payer} needs the PA x-ray for ${subject(f)}`,
  'denied:CO-16:M127:records_request': (f) => `${f.payer} asked for records before paying ${subject(f)}`,
  'denied:CO-119:frequency_history_conflict': (f) =>
    `${f.payer} denied ${subject(f)} as too frequent; its tooth history doesn't match our chart`,
  'denied:CO-22:cob_order': (f) => `${f.payer} says another plan pays first on ${subject(f)}`,
  'denied:CO-50:N10:formal_appeal': (f) => `${f.payer} denied ${subject(f)} as not medically necessary`,
  'denied:CO-29:timely_filing_appeal': (f) => `${f.payer} says ${subject(f)} was filed too late`,
  'denied:PR-119:max_met': () => 'The annual maximum is used up, so the balance goes to the patient',
  'pending:prompt_pay_eligible': (f) => `${f.payer} hasn't paid in ${f.days} days, past the prompt-pay limit`,
  'pending:status_due': (f) => `${f.payer} hasn't answered in ${f.days} days, so a status check is due`,
  'pending:adjudicated_no_835': (f) => `${f.payer} has processed this claim, but no 835 has come in`,
  'rejected:A7:164': (f) => {
    const otherId = f.params.field === 'subscriber_id' && f.params.source === '271'
    return `${f.payer} rejected the subscriber ID${otherId ? ', and the eligibility response has a different one' : ''}`
  },
  'variance:deductible_misapplied': (f) => `${f.payer} applied a deductible the patient already met`,
  'variance:alternate_benefit': (f) => `${f.payer} paid the alternate benefit; the difference may be billable to the patient`,
  'era:variance': (f) => `${f.payer}'s payment for ${subject(f)} doesn't match what we expected`,
}
const KEYS = Object.keys(SENTENCES).sort((a, b) => b.length - a.length)
export const RUN_FAILED_HEADLINE = "The agents couldn't finish this; it's back with you"

export function claimHeadline(situation: string | null | undefined, f: HeadlineFacts, denialCarc: string | null | undefined): string | null {
  const key = situation ? KEYS.find((k) => situation === k || situation.startsWith(`${k}:`)) : undefined
  const sentence = key ? SENTENCES[key] : undefined
  if (key && sentence && (f.days !== null || !key.startsWith('pending:'))) return sentence(f)
  return denialCarc ? `${f.payer} denied ${subject(f)} (${denialCarc})` : null
}

/** The API's `group_headline`: one counted sentence when every member shares situation, payer and procedure. */
export function groupHeadline(members: { situation?: string; payer: string; procedure: string }[], fallback: string): string {
  const one = <T,>(xs: T[]) => (new Set(xs).size === 1 ? xs[0] : undefined)
  const situation = one(members.map((m) => m.situation))
  const payer = one(members.map((m) => m.payer))
  const procedure = one(members.map((m) => m.procedure))
  const key = situation ? KEYS.find((k) => situation === k || situation.startsWith(`${k}:`)) : undefined
  const sentence = key ? SENTENCES[key] : undefined
  if (!key || !sentence || payer === undefined || procedure === undefined || key.startsWith('pending:')) return fallback
  return sentence({ payer, procedure, days: null, params: {}, n: members.length })
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "tomorrow's 9:00 AM visit", on the mock's frozen clock (ISO strings carry the practice's own offset). */
export function visitWhen(now: string, start: string): string {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
  const days = Math.round((day(start) - day(now)) / 86_400_000)
  const h = +start.slice(11, 13)
  const time = `${h % 12 || 12}:${start.slice(14, 16)} ${h < 12 ? 'AM' : 'PM'}`
  const weekday = WEEKDAY[new Date(day(start)).getUTCDay()] ?? ''
  const when =
    days === 0 ? "today's" : days === 1 ? "tomorrow's" : days > 1 && days < 7 ? `${weekday}'s` : `the ${+start.slice(5, 7)}/${+start.slice(8, 10)}`
  return `${when} ${time} visit`
}

export function eligibilityHeadline(issue: unknown, who: string, when: string, cdt: string | null | undefined): string | null {
  if (issue === 'over_max') return `${who} reaches the annual maximum at ${when}`
  if (issue === 'frequency') return `Too soon for ${who}'s plan to cover ${procedureNoun(cdt)} at ${when}`
  if (issue === 'unverified') return `${who}'s coverage couldn't be verified for ${when}`
  return null
}
