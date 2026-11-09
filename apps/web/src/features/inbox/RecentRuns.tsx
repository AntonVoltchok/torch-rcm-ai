import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useActiveLaunch } from '@/hooks/useActiveLaunch'
import { useLaunches } from '@/state/launches'

/**
 * "Runs you started", collapsed under the queue. Status is the server's (`useActiveLaunch` reads and polls
 * ['run', id]); opening one puts it in the pane, where the ProgressPanel streams it and replays what it missed.
 * Open/closed is ephemeral: the launch you are looking at is in the URL.
 */
export function RecentRuns({ active, onOpen }: { active: string | undefined; onOpen: (id: string) => void }) {
  const launches = useLaunches()
  const runs = useActiveLaunch()
  const [open, setOpen] = useState(false)
  if (launches.length === 0) return null
  return (
    <section aria-label="Runs you started" className="mt-2 border-t border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-hover">
        <span className="font-semibold">Runs you started</span>
        <span className="text-sm text-mid">{launches.length}</span>
        <span aria-hidden className={cn('ml-auto inline-block size-1.5 rotate-45 border-b-[1.5px] border-r-[1.5px] border-soft', open && '-rotate-[135deg]')} />
      </button>
      {open && (
        <ul className="m-0 list-none px-2 pb-1">
          {[...launches].reverse().map((l) => {
            const running = runs.isRunning(l)
            const stopped = l.runs.some((r) => runs.statusOf(r.run_id) === 'failed')
            return (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => onOpen(l.id)}
                  aria-current={active === l.id ? 'true' : undefined}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover', active === l.id && 'bg-act-bg')}
                >
                  <span className="truncate">{l.title}</span>
                  <span className={cn('ml-auto flex-none text-xs', running ? 'font-medium text-agents-ink' : stopped ? 'font-medium text-risk-ink' : 'text-mid')}>
                    {running ? 'Running' : stopped ? 'Stopped' : 'Done'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
