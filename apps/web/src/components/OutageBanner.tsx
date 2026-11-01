import { useWorldStatus } from '@/hooks/useStatic'
import { time } from '@/lib/format'

/** Driven by mock-world state. Infrastructure failures are explained, not turned into work for Dana. */
export function OutageBanner() {
  const world = useWorldStatus()
  const outages = world.data?.outages ?? []
  if (outages.length === 0) return null
  return (
    <div role="status" className="flex flex-col gap-0.5 border-b border-warn-line bg-warn-bg px-4 py-1.5 text-sm text-warn">
      {outages.map((o) => (
        <span key={o.system}>
          <b>{o.system}</b> is unreachable since {time(o.since)} — {o.message}
        </span>
      ))}
    </div>
  )
}
