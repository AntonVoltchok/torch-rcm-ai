import { useAdvanceClock, useAdvanceProgress, useClock, useResetDemo } from '@/hooks/useClock'
import { clockLabel, nextDay, nyInstant, practiceDay, weekday } from '@/lib/format'
import { canSee, useCurrentUser } from '@/state/session'
import { Button } from '@/components/ui/Button'

/**
 * Demo clock (owner-only, docs/spec/02-api.md "Clock"). The advance is async: 202 {advance_id}, then
 * progress from `event: advance` on the firehose (or polling) until `done`.
 */
export function ClockControl() {
  const user = useCurrentUser()
  const clock = useClock()
  const advance = useAdvanceClock()
  const reset = useResetDemo()
  const advanceId = advance.data?.advance_id ?? clock.data?.advancing?.advance_id
  const progress = useAdvanceProgress(advanceId)
  const now = clock.data?.now
  const running = Boolean(advanceId) && progress.data?.done !== true

  if (!now) return <span className="text-soft">Clock …</span>
  const target = nyInstant(nextDay(practiceDay(now)), '07:10')

  return (
    <div className="flex flex-col gap-1">
      <span>
        Demo clock · <b className="text-ink">{clockLabel(now)}</b>
      </span>
      {canSee.clock(user.role) ? (
        <>
          <Button size="sm" disabled={running || advance.isPending} onClick={() => advance.mutate(target)} title="Runs the scheduler: files leave, acks and 835s arrive, status checks fire">
            ⏭ Skip to {weekday(target)} 7:10 AM
          </Button>
          {running && (
            <span role="status" className="text-acc">
              Advancing… {typeof progress.data?.events_fired === 'number' ? `${progress.data.events_fired} events` : ''}
              {progress.data?.runs_started ? ` · ${progress.data.runs_started} runs` : ''}
            </span>
          )}
          <button type="button" className="self-start text-2xs text-soft underline hover:text-ink" onClick={() => reset.mutate()} disabled={reset.isPending}>
            Reset demo to Wed 10:40
          </button>
        </>
      ) : (
        <span className="text-2xs text-soft">Clock control: Dr. Morgan</span>
      )}
    </div>
  )
}
