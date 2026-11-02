import { useWorldPayers } from '@/hooks/useStatic'

/** Driven by the world's payer state: says why that payer's steps came back, so Dana does not chase the portal herself. */
export function OutageBanner() {
  const payers = useWorldPayers()
  const down = (payers.data ?? []).filter((p) => p.portal_down)
  if (down.length === 0) return null
  return (
    <div role="status" className="flex flex-col gap-0.5 border-b border-warn-line bg-warn-bg px-4 py-1.5 text-sm text-warn">
      {down.map((p) => (
        <span key={p.key}>
          <b>{p.name}</b> portal is unreachable — steps that need it come back to the Inbox.
        </span>
      ))}
    </div>
  )
}
