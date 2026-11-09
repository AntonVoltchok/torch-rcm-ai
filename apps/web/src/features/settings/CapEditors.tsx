/** Dollar caps: the practice-wide tier-2 cap (owner) and a rule's own "≤ $ per item" scope. Drafts live in react-hook-form. */
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/Button'
import { useSetPracticeCap } from '@/hooks/useRules'
import { money } from '@/lib/format'

const toCents = (dollars: string): number | null => {
  const n = Number(dollars.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

/** "Practice cap $1,000 / item · tier 1 exempt". Only Dr. Morgan edits it; everyone sees it. */
export function PracticeCapEditor({ cents, canEdit }: { cents: number; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const save = useSetPracticeCap()
  const { register, handleSubmit, formState } = useForm<{ dollars: string }>({ values: { dollars: String(cents / 100) } })
  if (!open) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-mid" data-tour="practice-cap">
        Practice cap <b className="text-ink">{money(cents)} / item</b> · tier 2 · tier 1 exempt
        {canEdit ? (
          <button type="button" className="font-medium text-act hover:underline" onClick={() => setOpen(true)}>
            Change
          </button>
        ) : (
          <span className="text-soft">· set by Dr. Morgan</span>
        )}
      </span>
    )
  }
  return (
    <form
      aria-label="Practice cap"
      data-tour="practice-cap"
      className="inline-flex items-center gap-1.5 text-sm"
      onSubmit={(e) => {
        void handleSubmit((v) => {
          const next = toCents(v.dollars)
          if (next === null) return
          save.mutate(next, { onSuccess: () => setOpen(false) })
        })(e)
      }}
    >
      <label className="inline-flex items-center gap-1 text-mid">
        Practice cap $
        <input {...register('dollars', { validate: (v) => toCents(v) !== null || 'Enter a dollar amount' })} inputMode="decimal" className="h-7 w-20 rounded-md border border-line-strong px-2 text-ink" aria-invalid={Boolean(formState.errors.dollars)} />
        / item
      </label>
      <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {formState.errors.dollars && <span className="text-risk-ink">{formState.errors.dollars.message}</span>}
    </form>
  )
}

/** A rule's own per-item cap: "Preview" asks the server what this week would have looked like; "Apply" PATCHes it. */
export function RuleCapEditor({
  cents,
  busy,
  onPreview,
  onApply,
}: {
  cents: number | null
  busy: boolean
  onPreview: (cents: number | null) => void
  onApply: (cents: number) => void
}) {
  const { register, handleSubmit, getValues, formState } = useForm<{ dollars: string }>({ values: { dollars: cents === null ? '' : String(cents / 100) } })
  return (
    <form
      aria-label="Cap per item"
      className="flex flex-wrap items-center gap-1.5 text-sm"
      onSubmit={(e) => {
        void handleSubmit((v) => {
          const next = toCents(v.dollars)
          if (next !== null) onApply(next)
        })(e)
      }}
    >
      <label className="inline-flex items-center gap-1 text-mid">
        Cap per item $
        <input
          {...register('dollars', { validate: (v) => toCents(v) !== null || 'Enter a dollar amount' })}
          inputMode="decimal"
          placeholder="any"
          className="h-7 w-20 rounded-md border border-line-strong px-2 text-ink"
          aria-invalid={Boolean(formState.errors.dollars)}
        />
      </label>
      <Button size="sm" onClick={() => onPreview(toCents(getValues('dollars')))}>
        Preview
      </Button>
      <Button type="submit" size="sm" variant="primary" disabled={busy}>
        Apply
      </Button>
      {formState.errors.dollars && <span className="text-risk-ink">{formState.errors.dollars.message}</span>}
    </form>
  )
}
