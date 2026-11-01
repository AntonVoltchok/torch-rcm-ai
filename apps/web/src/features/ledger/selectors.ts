/** Today's claims: grouping and ack-stage chips over GET /ledger/today rows. Sums add the server's billed cents. */
import type { AckEvent, HoldReason, Ledger, LedgerRow } from '@/api/schema'
import { time } from '@/lib/format'

export type AckTone = 'ok' | 'bad' | 'pending' | 'none'
export interface AckChip {
  tone: AckTone
  text: string
}

/** 999 (file) → Vyne 277CA (minutes) → payer 277CA (usually overnight). An A7 is a reject, not a denial. */
export function ackChips(acks: AckEvent[], sent: boolean): { file: AckChip; vyne: AckChip; payer: AckChip } {
  const last = (pred: (a: AckEvent) => boolean) => [...acks].filter(pred).sort((a, b) => a.at.localeCompare(b.at)).at(-1)
  const file = last((a) => a.stage === 'file_999_ok' || a.stage === 'file_999_reject')
  const vyneAll = acks.filter((a) => a.stage === 'ch_277ca_a1' || a.stage === 'ch_277ca_a7').sort((a, b) => a.at.localeCompare(b.at))
  const vyne = vyneAll.at(-1)
  const a7 = vyneAll.find((a) => a.stage === 'ch_277ca_a7')
  const payer = last((a) => a.stage === 'payer_277ca_a1' || a.stage === 'payer_277ca_a7')
  const waiting: AckChip = sent ? { tone: 'pending', text: 'pending' } : { tone: 'none', text: '—' }
  return {
    file: file ? (file.stage === 'file_999_ok' ? { tone: 'ok', text: '✓' } : { tone: 'bad', text: '999 reject' }) : waiting,
    vyne: vyne
      ? vyne.stage === 'ch_277ca_a1'
        ? { tone: 'ok', text: a7 ? `${a7.code ?? 'A7'} ${time(a7.at)} → A1 ${time(vyne.at)}` : `A1 · ${time(vyne.at)}` }
        : { tone: 'bad', text: `${vyne.code ?? 'A7'} · ${time(vyne.at)}` }
      : waiting,
    payer: payer ? (payer.stage === 'payer_277ca_a1' ? { tone: 'ok', text: payer.message.includes('ICN') ? payer.message.replace(/^.*ICN/, 'A1 ICN') : 'A1' } : { tone: 'bad', text: payer.code ?? 'A7' }) : waiting,
  }
}

export interface FileGroup {
  file_time: string | null
  rows: LedgerRow[]
  cents: number
}

/** "Leaving in the 10:45 file · 4 · $2,985" — one group per payer-file time, earliest first. */
export function fileGroups(rows: LedgerRow[]): FileGroup[] {
  const by = new Map<string, LedgerRow[]>()
  for (const r of rows) {
    const k = r.file_time ?? ''
    by.set(k, [...(by.get(k) ?? []), r])
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : Date.parse(a) - Date.parse(b)))
    .map(([k, rs]) => ({ file_time: k || null, rows: rs, cents: rs.reduce((a, r) => a + r.claim.billed_cents, 0) }))
}

export function ledgerTotals(l: Ledger) {
  const sum = (rows: { claim: { billed_cents: number } }[]) => rows.reduce((a, r) => a + r.claim.billed_cents, 0)
  return {
    sent: { count: l.sent.length, cents: sum(l.sent) },
    leaving: { count: l.leaving_next_file.length, cents: sum(l.leaving_next_file) },
    held: { count: l.held.length, cents: sum(l.held) },
    notBillable: l.not_billable.length,
    total: l.sent.length + l.leaving_next_file.length + l.held.length,
  }
}

export const HOLD_REASON: Record<HoldReason, string> = {
  note_unsigned: 'Note not signed',
  procs_not_in_note: 'Procedures not in the note',
  rendering_mismatch: 'Rendering provider mismatch',
  awaiting_primary_eob: 'Secondary waits for the primary EOB',
  missing_image: 'Image missing',
  subscriber_id_invalid: 'Subscriber id invalid',
  other_documented: 'Held',
  reprocessing_requested: 'Reprocessing requested',
}
