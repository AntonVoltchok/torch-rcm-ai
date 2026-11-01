import { useQueries } from '@tanstack/react-query'
import { runQueryOptions } from '@/hooks/useRun'
import { isTerminal } from '@/lib/runEvents'
import { cn } from '@/lib/cn'
import { useLaunches } from '@/state/launches'

/**
 * "Runs you started" — reads ['run', id] (fetched once if not cached) without subscribing to SSE; the
 * ProgressPanel subscribes when opened and replays what it missed via Last-Event-ID.
 */
export function RecentRuns({ active, onOpen }: { active: string | undefined; onOpen: (id: string) => void }) {
  const launches = useLaunches()
  const runIds = launches.flatMap((l) => l.runs.map((r) => r.run_id))
  const runs = useQueries({
    queries: runIds.map((id) => runQueryOptions(id)),
  })
  if (launches.length === 0) return null
  const statusOf = (id: string) => runs[runIds.indexOf(id)]?.data?.status
  return (
    <section aria-label="Runs you started" className="border-t border-line bg-fill px-3 py-2">
      <div className="mb-1 text-2xs font-extrabold uppercase tracking-[.05em] text-soft">Runs you started</div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {[...launches].reverse().map((l) => {
          const statuses = l.runs.map((r) => statusOf(r.run_id))
          const done = statuses.every((s) => s !== undefined && isTerminal(s))
          return (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onOpen(l.id)}
                className={cn('flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-white', active === l.id && 'bg-white font-semibold')}
              >
                <span className="text-acc">✦</span>
                <span className="truncate">{l.title}</span>
                <span className={cn('ml-auto text-xs', done ? 'text-ok' : 'text-acc')}>{done ? 'done' : 'running'}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
