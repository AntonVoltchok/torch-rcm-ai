import { useEffect, useState } from 'react'
import { findAnchor } from './anchors'

export interface AnchorState {
  /** `null` while looking; `false` once the grace period passed without the anchor. */
  rect: DOMRect | null | false
  el: HTMLElement | null
}

/**
 * Tracks a `data-tour` anchor's box. Measures on scroll (any scroller), resize, the anchor's own resize and DOM changes
 * (a run pane opening, a query landing), batched to one measurement per frame; nothing runs between those events.
 * Gives up after `graceMs` so a step whose element is not on screen can say so instead of pointing at nothing.
 */
export function useAnchorRect(name: string | undefined, key: string, graceMs = 2500): AnchorState {
  const [state, setState] = useState<AnchorState>({ rect: null, el: null })

  useEffect(() => {
    // The last box stays until the new anchor is measured, so a re-anchor does not flash the card to the centre.
    if (!name) return
    let frame = 0
    let scrolled: HTMLElement | null = null
    let resize: ResizeObserver | null = null
    let expired = false
    let found = false
    let lost: number | undefined

    const measure = () => {
      frame = 0
      const el = findAnchor(name)
      if (!el) {
        // An anchor seen once and gone briefly (a user switch re-renders the shell) gets a moment before "missing".
        if (found && lost === undefined)
          lost = window.setTimeout(() => {
            if (!findAnchor(name)) setState({ rect: false, el: null })
          }, 800)
        else if (!found) setState((s) => (s.rect === false || !expired ? s : { rect: false, el: null }))
        return
      }
      found = true
      clearTimeout(lost)
      lost = undefined
      if (el !== scrolled) {
        scrolled = el
        resize?.disconnect()
        // Absent in jsdom and very old browsers; scroll, resize and DOM changes still re-measure.
        resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
        resize?.observe(el)
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
      }
      const r = el.getBoundingClientRect()
      setState((s) => (s.el === el && s.rect && sameRect(s.rect, r) ? s : { rect: r, el }))
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure)
    }

    // The app shell, not the body: the tour's own card (a streaming run pane) must not re-measure every frame.
    const mo = new MutationObserver(schedule)
    mo.observe(document.getElementById('app-shell') ?? document.body, { childList: true, subtree: true })
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const grace = window.setTimeout(() => {
      expired = true
      schedule()
    }, graceMs)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(grace)
      clearTimeout(lost)
      mo.disconnect()
      resize?.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [name, key, graceMs])

  return state
}

const sameRect = (a: DOMRect, b: DOMRect) => a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
