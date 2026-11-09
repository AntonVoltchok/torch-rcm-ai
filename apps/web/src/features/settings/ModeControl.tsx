import type { RuleMode } from '@/api/schema'
import { cn } from '@/lib/cn'
import { MODE_LABEL, type RuleRowView } from './selectors'

/**
 * Per-row mode control. Tier 3 renders as text with no control (there is no code path that automates it).
 * Hover or focus on an option previews it (GET /settings/preview); click commits it (PATCH /rules/{id}).
 * A tier-2 row for anyone but the owner says so up front: the change becomes Dr. Morgan's sign-off item.
 */
export function ModeControl({
  row,
  busy,
  onPreview,
  onChange,
}: {
  row: RuleRowView
  busy: boolean
  onPreview: (mode: RuleMode | null) => void
  onChange: (mode: RuleMode) => void
}) {
  if (row.control === 'human_only') {
    return (
      <span
        className="inline-flex items-center gap-1 text-sm font-semibold text-ink"
        data-testid="human-only"
        title="Tier 3 commits the practice: a person, always. Agents may draft."
      >
        Human only
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div
        role="radiogroup"
        aria-label={`Mode for ${row.label}`}
        data-rule={row.id}
        className="inline-flex overflow-hidden rounded-md border border-line-strong"
        onMouseLeave={() => onPreview(null)}
      >
        {row.options.map((m) => {
          const on = m === row.mode
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              data-mode={m}
              disabled={busy}
              title={row.needsOwner && !on ? `${MODE_LABEL[m]} · needs Dr. Morgan’s sign-off` : MODE_LABEL[m]}
              onMouseEnter={() => onPreview(m)}
              onFocus={() => onPreview(m)}
              onBlur={() => onPreview(null)}
              onClick={() => {
                if (!on) onChange(m)
              }}
              className={cn(
                'whitespace-nowrap border-l border-line-strong px-2 py-0.5 text-xs font-medium first:border-l-0 disabled:cursor-wait',
                // Ask is the practice's move, so it takes the practice hue; auto is green; observe is neutral.
                on
                  ? m === 'auto'
                    ? 'bg-ok-bg text-ok'
                    : m === 'observe'
                      ? 'bg-light text-ink'
                      : 'bg-practice-bg text-practice-ink'
                  : 'bg-paper text-mid hover:bg-hover hover:text-ink',
              )}
            >
              {MODE_LABEL[m]}
            </button>
          )
        })}
      </div>
      {row.needsOwner && <span className="text-xs font-medium text-mid">Needs Dr. Morgan</span>}
    </div>
  )
}
