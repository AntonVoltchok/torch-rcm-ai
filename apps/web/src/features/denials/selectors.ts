/** Denials worklist view logic over GET /denials (rows already routed by the server's route_denial). */
import type { DenialRow, DenialsOut, NextAction, PayerKey, Tier } from '@/api/schema'

/** The path chip and its tier: reconsideration is a portal action without a signature; a formal appeal commits the practice. */
export const PATH: Record<NextAction, { label: string; tier: Tier }> = {
  reconsideration: { label: 'Reconsideration', tier: 1 },
  corrected: { label: 'Corrected / COB resubmit', tier: 2 },
  formal_appeal: { label: 'Formal appeal', tier: 3 },
  bill_patient_link: { label: 'Bill patient', tier: 2 },
  write_off: { label: 'Write off', tier: 3 },
}

/** Path tier, raised where the row's own facts raise it: a signature is tier 3, agent-written inquiry text is tier 2. */
export function pathTier(r: DenialRow): Tier {
  if (r.signer) return 3
  const base = PATH[r.next_action].tier
  return r.next_action === 'reconsideration' && r.carc === 'CO-119' ? 2 : base
}

export const tag = (r: DenialRow): 'ours' | 'theirs' => (r.root_cause === 'ours' ? 'ours' : 'theirs')

/** "if we lose": from the 835 group code — CO cannot be billed to the patient, PR can. */
export function ifWeLose(r: DenialRow): string {
  if (r.patient_billable_if_lost === null) return 'unknown'
  if (r.patient_billable_if_lost) return 'patient can be billed'
  return r.carc === 'CO-29' ? 'patient cannot be billed → non-contractual write-off' : 'patient cannot be billed'
}

/** Typed deadline with days left on the server clock: "appeal · 179 d". */
export function deadlineLabel(r: DenialRow, today: string): { text: string; days: number | null } {
  const d = r.deadline
  if (d.kind === 'none' || !d.due_on) return { text: d.basis || 'no deadline', days: null }
  const days = daysUntil(d.due_on, today)
  return { text: `${d.kind === 'timely_filing' ? 'timely' : 'appeal'} · ${days} d`, days }
}

/** Reason classes for the payer × reason matrix; plan limits (max met, alternate benefit) are not denials of care. */
export const REASONS = ['Doc', 'Freq', 'COB', 'TF', 'Med. nec.', 'Other'] as const
export type ReasonClass = (typeof REASONS)[number] | 'plan_limit'
export function reasonClass(carc: string): ReasonClass {
  if (carc === 'CO-16') return 'Doc'
  if (carc === 'CO-119') return 'Freq'
  if (carc === 'CO-22') return 'COB'
  if (carc === 'CO-29') return 'TF'
  if (carc === 'CO-50') return 'Med. nec.'
  if (carc.startsWith('PR-')) return 'plan_limit'
  return 'Other'
}

export interface Matrix {
  payers: { key: PayerKey; name: string; cells: Record<string, number>; total: number }[]
  totals: Record<string, number>
  total: number
  excluded: number
}

/** Counts of the worklist's rows by payer × reason (a selector over server rows, never a stored count). */
export function payerReasonMatrix(rows: DenialRow[]): Matrix {
  const by = new Map<PayerKey, { key: PayerKey; name: string; cells: Record<string, number>; total: number }>()
  const totals: Record<string, number> = {}
  let excluded = 0
  for (const r of rows) {
    const cls = reasonClass(r.carc)
    if (cls === 'plan_limit') {
      excluded++
      continue
    }
    const p = by.get(r.claim.payer.key) ?? { key: r.claim.payer.key, name: r.claim.payer.short_name, cells: {}, total: 0 }
    p.cells[cls] = (p.cells[cls] ?? 0) + 1
    p.total++
    totals[cls] = (totals[cls] ?? 0) + 1
    by.set(r.claim.payer.key, p)
  }
  const payers = [...by.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  return { payers, totals, total: payers.reduce((a, p) => a + p.total, 0), excluded }
}

/** Whole days from the practice's today to a due date, both read at noon UTC so no timezone moves a day. */
export function daysUntil(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
}

/** The deadline's verb from its kind: an appeal window, or the payer's filing limit for a corrected claim. */
export function deadlineVerb(kind: DenialRow['deadline']['kind']): string {
  return kind === 'appeal' ? 'Appeal by' : kind === 'timely_filing' ? 'File by' : 'Deadline'
}

/** A row's place on the worklist: server group order, then soonest deadline, then claim number. */
export function sortedRows(rows: readonly DenialRow[]): DenialRow[] {
  const due = (r: DenialRow) => r.deadline.due_on ?? '9999-12-31'
  return [...rows].sort((a, b) => due(a).localeCompare(due(b)) || a.claim.number - b.claim.number)
}

/** The worklist in screen order (the claim page's "Next denial" follows it). */
export function worklistOrder(d: DenialsOut): DenialRow[] {
  return d.groups.flatMap((g) => sortedRows(g.rows))
}

/** "Patient cannot be billed (CO)" etc.: the 835 group code decides who can be billed. */
export const isPatientResp = (carc: string) => carc.startsWith('PR-')
