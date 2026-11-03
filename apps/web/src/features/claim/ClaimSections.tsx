import type { AckEvent, Attachment, ClaimLine } from '@/api/schema'
import { cdtName } from '@/lib/cdt'
import { dateTime, money } from '@/lib/format'
import { cn } from '@/lib/cn'

export function LinesTable({ lines, estimate }: { lines: ClaimLine[]; estimate: boolean }) {
  const sum = (pick: (l: ClaimLine) => number | null | undefined) => {
    const vals = lines.map(pick)
    return vals.every((v) => v === null || v === undefined) ? null : vals.reduce<number>((a, v) => a + (v ?? 0), 0)
  }
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-2xs font-extrabold uppercase tracking-[.05em] text-soft">
          <th className="py-1 pr-2">CDT</th>
          <th className="py-1 pr-2">Tooth</th>
          <th className="py-1 pr-2">Description</th>
          <th className="py-1 pr-2 text-right">Billed</th>
          <th className="py-1 pr-2 text-right">{estimate ? 'Allowed · est.' : 'Allowed'}</th>
          <th className="py-1 pr-2 text-right">Paid</th>
          <th className="py-1 pr-2">Adjustments</th>
          <th className="py-1 text-right">Patient · 835</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="h-9 border-t border-light">
            <td className="pr-2 font-mono text-xs">{l.cdt}</td>
            <td className="pr-2">{l.tooth ?? '—'}</td>
            <td className="pr-2">{cdtName(l.cdt) ?? '—'}</td>
            <td className="pr-2 text-right">{money(l.fee_cents)}</td>
            <td className="pr-2 text-right">{money(l.allowed_cents ?? null)}</td>
            <td className="pr-2 text-right">{money(l.paid_cents ?? null)}</td>
            <td className="pr-2 text-xs text-mid">{l.adj?.length ? l.adj.map((a) => `${a.group}-${a.code} ${money(a.cents)}`).join(' · ') : '—'}</td>
            <td className="text-right">{money(l.patient_cents ?? null)}</td>
          </tr>
        ))}
        <tr className="border-t border-line font-bold">
          <td className="py-1" colSpan={3}>
            Total
          </td>
          <td className="pr-2 text-right">{money(sum((l) => l.fee_cents))}</td>
          <td className="pr-2 text-right">{money(sum((l) => l.allowed_cents))}</td>
          <td className="pr-2 text-right">{money(sum((l) => l.paid_cents))}</td>
          <td />
          <td className="text-right">{money(sum((l) => l.patient_cents))}</td>
        </tr>
      </tbody>
    </table>
  )
}

const ATT_LABEL: Record<Attachment['kind'], string> = { pa: 'PA x-ray', bwx: 'BWX', fmx: 'FMX', perio_chart: 'Perio chart', narrative: 'Narrative', eob: 'EOB / 835' }

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return <p className="m-0 text-sm text-soft">No attachments.</p>
  return (
    <ul className="m-0 list-none p-0 text-sm">
      {attachments.map((a) => (
        <li key={a.id} className="flex items-center gap-2 border-b border-light py-1 last:border-b-0">
          <b>{ATT_LABEL[a.kind]}</b>
          <span className="text-mid">{a.note ?? ''}</span>
          <span className="ml-auto whitespace-nowrap text-xs text-mid">
            {a.nea_number ? `NEA# ${a.nea_number} · ` : ''}
            {a.source.replace('_', ' ')} · {dateTime(a.created_at)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function AcksList({ acks }: { acks: AckEvent[] }) {
  if (acks.length === 0) return <p className="m-0 text-sm text-soft">Not sent yet — no acknowledgements.</p>
  return (
    <ol className="m-0 list-none p-0 text-sm">
      {acks.map((a) => (
        <li key={a.id} className="flex gap-2 py-0.5">
          <span className={cn('font-mono text-xs', /a7|reject/.test(a.stage) ? 'text-bad' : 'text-ok')}>{a.code ?? (a.stage.includes('999') ? '999' : '—')}</span>
          <span>{a.message}</span>
          <span className="ml-auto whitespace-nowrap text-xs text-mid">{dateTime(a.at)}</span>
        </li>
      ))}
    </ol>
  )
}
