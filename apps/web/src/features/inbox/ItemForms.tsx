/** Edit / Reject / Snooze forms. Drafts are component state (react-hook-form), never the cache or URL. */
import { useForm } from 'react-hook-form'
import type { InboxItem } from '@/api/schema'
import { Button } from '@/components/ui/Button'
import { nextDay, nyInstant, practiceDay, weekday } from '@/lib/format'

export function EditPlanForm({ item, onSubmit, onCancel, busy }: { item: InboxItem; onSubmit: (edits: Record<string, unknown>) => void; onCancel: () => void; busy: boolean }) {
  const editable = Object.entries(item.proposed_action?.params ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number')
  const { register, handleSubmit, formState } = useForm<Record<string, string>>({
    defaultValues: { ...Object.fromEntries(editable.map(([k, v]) => [k, String(v)])), note: '' },
  })
  return (
    <form
      aria-label="Edit plan"
      className="flex flex-col gap-2 rounded-lg border border-line bg-fill p-3"
      onSubmit={(e) => {
        void handleSubmit((values) => {
          onSubmit(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')))
        })(e)
      }}
    >
      <div className="text-sm font-bold">Edit the plan before it runs</div>
      {editable.map(([key]) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <span className="w-28 text-mid">{key.replace(/_/g, ' ')}</span>
          <input {...register(key, { required: true })} className="flex-1 rounded border border-line bg-white px-2 py-1" />
        </label>
      ))}
      <label className="flex items-start gap-2 text-sm">
        <span className="w-28 text-mid">Note to payer</span>
        <textarea
          {...register('note', { maxLength: 500 })}
          rows={2}
          className="flex-1 rounded border border-line bg-white px-2 py-1"
          placeholder="Optional · goes in the claim remarks"
        />
      </label>
      {formState.errors.note && <span className="text-xs text-risk-ink">500 characters at most.</span>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Approve with edits
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

const REASONS = ['Wrong fix for this claim', 'Already handled outside TorchRCM', 'Payer told us otherwise', 'Other'] as const

export function RejectForm({ onSubmit, onCancel, busy }: { onSubmit: (reason: string) => void; onCancel: () => void; busy: boolean }) {
  const { register, handleSubmit, watch, formState } = useForm<{ reason: (typeof REASONS)[number]; detail: string }>({ defaultValues: { reason: REASONS[0], detail: '' } })
  const reason = watch('reason')
  return (
    <form
      aria-label="Reject"
      className="flex flex-col gap-2 rounded-lg border border-line bg-fill p-3"
      onSubmit={(e) => {
        void handleSubmit((v) => {
          onSubmit(v.reason === 'Other' ? v.detail : v.detail ? `${v.reason}: ${v.detail}` : v.reason)
        })(e)
      }}
    >
      <div className="text-sm font-bold">Reject — the agent will not retry this proposal</div>
      <select {...register('reason')} className="rounded border border-line bg-white px-2 py-1 text-sm">
        {REASONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>
      <textarea
        {...register('detail', { validate: (v) => reason !== 'Other' || v.trim().length >= 3 || 'Say why in a few words.' })}
        rows={2}
        className="rounded border border-line bg-white px-2 py-1 text-sm"
        placeholder="Detail (feeds the learning stats)"
      />
      {formState.errors.detail && <span className="text-xs text-risk-ink">{formState.errors.detail.message}</span>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={busy}>
          Reject
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Snooze targets are computed from the server clock, never the browser's. */
export function snoozeOptions(now: string): { label: string; until: string }[] {
  const today = practiceDay(now)
  const tomorrow = nextDay(today)
  let monday = tomorrow
  for (let i = 0; i < 7 && weekday(nyInstant(monday, '07:00')) !== 'Mon'; i++) monday = nextDay(monday)
  const in3 = nextDay(nextDay(tomorrow))
  return [
    { label: `${weekday(nyInstant(tomorrow, '07:00'))} 7:00 AM`, until: nyInstant(tomorrow, '07:00') },
    { label: `${weekday(nyInstant(in3, '07:00'))} 7:00 AM`, until: nyInstant(in3, '07:00') },
    { label: `Mon 7:00 AM`, until: nyInstant(monday, '07:00') },
  ]
}

export function SnoozeMenu({ now, onPick, onCancel }: { now: string; onPick: (until: string, label: string) => void; onCancel: () => void }) {
  return (
    <div role="menu" aria-label="Snooze until" className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-fill p-3 text-sm">
      <span className="font-bold">Snooze until</span>
      {snoozeOptions(now).map((o) => (
        <Button key={o.until} role="menuitem" size="sm" onClick={() => onPick(o.until, o.label)}>
          {o.label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
