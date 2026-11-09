/** Today's claims: ack-stage chips and file groups over GET /ledger/today. Totals are the server's (`totals`, `files`). */
import type { AckEvent, HoldReason, Ledger, LedgerFile, LedgerRow } from '@/api/schema'
import { time } from '@/lib/format'

export type AckTone = 'ok' | 'bad' | 'pending' | 'none'
export interface AckChip {
  tone: AckTone
  text: string
}

/** 999 (file) → Vyne 277CA (minutes) → payer 277CA (usually overnight). An A7 is a reject, not a denial. */
export function ackChips(acks: AckEvent[], sent: boolean): { file: AckChip; vyne: AckChip; payer: AckChip } {
  const last = (pred: (a: AckEvent) => boolean) =>
    [...acks]
      .filter(pred)
      .sort((a, b) => a.at.localeCompare(b.at))
      .at(-1)
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
    payer: payer
      ? payer.stage === 'payer_277ca_a1'
        ? { tone: 'ok', text: payer.message.includes('ICN') ? payer.message.replace(/^.*ICN/, 'A1 ICN') : 'A1' }
        : { tone: 'bad', text: payer.code ?? 'A7' }
      : waiting,
  }
}

export interface FileGroup {
  file: LedgerFile
  rows: LedgerRow[]
}

/**
 * "Leaving in the 10:45 file · 4 · $2,985": the server's `files` (count and cents computed there), each with its rows
 * picked from `leaving_next_file` by claim id. Nothing is added up here.
 */
export function fileGroups(l: Ledger): FileGroup[] {
  const byId = new Map(l.leaving_next_file.map((r) => [r.claim.id, r]))
  return l.files.map((file) => ({ file, rows: file.claim_ids.flatMap((id) => byId.get(id) ?? []) }))
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
