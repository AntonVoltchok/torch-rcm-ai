import type { PreviewParams } from '@/api/endpoints'
import type { RuleMode } from '@/api/schema'
import { usePreview } from '@/hooks/useRules'
import { money } from '@/lib/format'
import { SkeletonBlock } from '@/components/ui/Skeleton'
import { MODE_LABEL, previewView } from './selectors'

/**
 * Live preview: this week's decisions replayed under the hovered / selected change (GET /settings/preview).
 * The server computes every number (`before_holds`, `held_total`, `net_change`); the panel only words them.
 */
export function PreviewPanel({ target, ruleLabel, currentMode }: { target: PreviewParams | null; ruleLabel: string | undefined; currentMode: RuleMode | undefined }) {
  const q = usePreview(target)
  const mode = target?.mode ?? currentMode
  return (
    <section aria-label="Live preview" data-tour="preview" aria-live="polite" className="flex min-w-[340px] flex-col gap-1 rounded-lg border border-line bg-fill px-4 py-2.5">
      <div className="text-sm font-semibold text-ink">
        Live preview{ruleLabel ? ` · ${ruleLabel}` : ''}
        {mode ? ` → ${MODE_LABEL[mode]}` : ''}
        {target?.max_cents !== undefined ? ` · cap ${money(target.max_cents)}` : ''}
      </div>
      {!target ? (
        <p className="m-0 text-sm text-mid">Hover a mode to see what this week would have looked like.</p>
      ) : q.isPending ? (
        <SkeletonBlock className="h-9 w-full" />
      ) : q.isError ? (
        <p className="m-0 text-sm text-risk-ink">
          Preview unavailable.{' '}
          <button type="button" className="underline" onClick={() => void q.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        (() => {
          const v = previewView(q.data)
          return (
            <div className={q.isFetching ? 'opacity-70 transition-opacity' : undefined} data-testid="preview">
              <div className="flex items-baseline gap-2">
                <b className="text-title font-semibold text-ink nums-proportional" data-testid="preview-numbers">
                  {v.from} → {v.to}
                </b>
                <span className="text-sm text-mid">of this week’s {v.total} would have run</span>
              </div>
              {v.holdLine ? (
                <p className="m-0 text-sm font-medium text-ink" data-testid="preview-held">
                  {v.holdLine}
                </p>
              ) : (
                <p className="m-0 text-sm text-mid">{v.changeLine}</p>
              )}
            </div>
          )
        })()
      )}
    </section>
  )
}
