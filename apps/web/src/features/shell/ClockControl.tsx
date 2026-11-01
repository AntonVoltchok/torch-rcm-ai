import { advanceEvents, useAdvanceClock, useAdvanceCompletion, useAdvanceProgress, useClock, useResetDemo } from '@/hooks/useClock'
import { clockLabel, nextDay, nyInstant, practiceDay, time, weekday } from '@/lib/format'
import { canSee, useCurrentUser } from '@/state/session'
import { Button } from '@/components/ui/Button'

/**
 * Demo clock (owner-only, docs/spec/02-api.md "Clock"). The advance is async: 202 {advance_id}, then progress
 * from `event: advance` on the firehose (or polling GET /clock/advance/{id} when the stream is down) until
 * `done`. The control stays disabled while any advance runs — this tab's or another's (`clock.advancing`).
 * When it finishes, every cached read is invalidated (useAdvanceCompletion).
 */
export function ClockControl() {
  const user = useCurrentUser()
  const clock = useClock()
  const advance = useAdvanceClock()
  const reset = useResetDemo()
  const advanceId = clock.data?.advancing?.advance_id ?? advance.data?.advance_id
  const progress = useAdvanceProgress(advanceId)
  useAdvanceCompletion(advanceId, progress.data)
  const now = clock.data?.now
  const running = Boolean(advanceId) && !progress.isError && progress.data?.done !== true
  const advancing = running || advance.isPending

  if (!now) return <span className="text-soft">Clock …</span>
  const target = nyInstant(nextDay(practiceDay(now)), '07:10')
  const events = advanceEvents(progress.data)

  return (
    <div className="flex flex-col gap-1" data-testid="clock-control">
      <span>
        Demo clock · <b className="text-ink">{clockLabel(now)}</b>
      </span>
      {canSee.clock(user.role) ? (
        <>
          <Button size="sm" disabled={advancing || reset.isPending} onClick={() => advance.mutate(target)} title="Runs the scheduler: files leave, acks and 835s arrive, status checks fire">
            ⏭ Skip to {weekday(target)} 7:10 AM
          </Button>
          {advancing && (
            <span role="status" aria-label="Clock advancing" className="flex flex-col text-acc" data-testid="advance-progress">
              <span className="inline-flex items-center gap-1 font-semibold">
                <span aria-hidden className="animate-torch-spin inline-block h-2.5 w-2.5 rounded-full border-2 border-acc border-t-transparent" />
                Advancing…
              </span>
              <span>
                {events} events · {progress.data?.runs_started ?? 0} runs
                {progress.data?.now ? ` · at ${weekday(progress.data.now)} ${time(progress.data.now)}` : ''}
              </span>
            </span>
          )}
          {progress.data?.done && progress.data.state === 'failed' && <span className="text-bad">Advance failed{progress.data.error ? `: ${progress.data.error}` : ''}.</span>}
          <button type="button" className="self-start text-2xs text-soft underline hover:text-ink disabled:no-underline" onClick={() => reset.mutate(undefined, { onSuccess: () => advance.reset() })} disabled={reset.isPending || advancing}>
            Reset demo to Wed 10:40
          </button>
        </>
      ) : (
        <span className="text-2xs text-soft">{advancing ? 'Clock advancing…' : 'Clock control: Dr. Morgan'}</span>
      )}
    </div>
  )
}
