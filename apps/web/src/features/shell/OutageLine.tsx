import { useWorldPayers } from '@/hooks/useStatic'

/**
 * A payer portal that is down, as one quiet line in the sidebar foot (D1). The full sentence is in the text, not a
 * tooltip: "Cigna portal unreachable. Steps that need it come back to the Inbox." `role="status"` announces it
 * when it changes. Items that came back because of it say so themselves (phase 2).
 */
export function OutageLine() {
  const payers = useWorldPayers()
  const down = (payers.data ?? []).filter((p) => p.portal_down)
  if (down.length === 0) return null
  return (
    <div role="status" data-testid="outage" className="flex flex-col gap-1 text-xs text-soft">
      {down.map((p) => (
        <p key={p.key} className="m-0 flex items-start gap-2">
          <i aria-hidden className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-nobody" />
          <span>
            <span className="font-medium text-mid">{p.name} portal unreachable.</span> Steps that need it come back to the Inbox.
          </span>
        </p>
      ))}
    </div>
  )
}
