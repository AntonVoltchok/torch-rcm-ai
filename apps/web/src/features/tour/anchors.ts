/**
 * Anchors are `data-tour="name"` on the real elements of each screen. The tour finds them, measures them and, for a
 * "Try it", presses them: the same control a person would press, so every guard and every hook runs unchanged.
 */
export const anchorSelector = (name: string) => `[data-tour="${name}"]`

export function findAnchor(name: string | undefined, root: ParentNode = document): HTMLElement | null {
  if (!name) return null
  return root.querySelector<HTMLElement>(anchorSelector(name))
}

/** Presses the real control. Refuses a disabled one with the app's own reason (its `title`), never forces it. */
export function press(name: string): void {
  const el = findAnchor(name)
  const button = el?.matches('button') ? (el as HTMLButtonElement) : el?.querySelector('button')
  if (!button) throw new Error('That control is not on screen right now.')
  if (button.disabled) throw new Error(button.title || 'That control is disabled right now.')
  button.click()
}

/**
 * Hovers a control the way a pointer would. React's onMouseEnter listens to `mouseover` at the root, so this runs the
 * component's own hover handler (Settings previews a mode on hover; clicking would commit it).
 */
let hovered: Element | null = null
export function hover(el: Element): void {
  unhover()
  hovered = el
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }))
}

/** Ends a hover the tour started (React's onMouseLeave listens to `mouseout`), so no preview outlives its step. */
export function unhover(): void {
  if (hovered?.isConnected) hovered.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
  hovered = null
}

/** Thrown from an `until` predicate to stop waiting with that message (a refused mutation). */
export class TryFailed extends Error {}

/** Polls `fn` every 100 ms until it holds; rejects with `what` after `ms` (counted in ticks: no clock is read). */
export function until(fn: () => boolean, ms: number, what: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let waited = 0
    const tick = () => {
      if (signal?.aborted) {
        reject(new DOMException('Tour exited', 'AbortError'))
        return
      }
      let ok = false
      try {
        ok = fn()
      } catch (e) {
        if (e instanceof TryFailed) {
          reject(e)
          return
        }
        ok = false
      }
      if (ok) resolve()
      else if (waited >= ms) reject(new Error(what))
      else {
        waited += 100
        setTimeout(tick, 100)
      }
    }
    tick()
  })
}
