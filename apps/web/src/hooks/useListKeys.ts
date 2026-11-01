/**
 * The one keyboard module (docs/spec/05-frontend.md "Keyboard"): j/k move, enter open, plus per-screen
 * bindings ("a", "shift+a", "g c"). Keys are ignored while typing in a field or with ctrl/meta/alt held.
 */
import { useEffect, useLayoutEffect, useRef } from 'react'

export type KeyBindings = Record<string, (() => void) | undefined>

interface Options {
  ids: readonly string[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  onOpen?: (id: string) => void
  bindings?: KeyBindings
  enabled?: boolean
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function keyName(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  return e.shiftKey && e.key.length === 1 ? `shift+${k}` : k
}

/** Next id for j/k; wraps nothing — the ends are the ends. */
export function step(ids: readonly string[], current: string | undefined, delta: 1 | -1): string | undefined {
  if (ids.length === 0) return undefined
  const i = current === undefined ? -1 : ids.indexOf(current)
  if (i === -1) return delta === 1 ? ids[0] : ids[ids.length - 1]
  return ids[Math.min(ids.length - 1, Math.max(0, i + delta))]
}

export function useListKeys(opts: Options): void {
  const ref = useRef(opts)
  useLayoutEffect(() => {
    ref.current = opts
  })
  const pendingG = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const o = ref.current
      if (o.enabled === false || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      const name = keyName(e)
      if (pendingG.current) {
        pendingG.current = false
        const seq = o.bindings?.[`g ${name}`]
        if (seq) {
          e.preventDefault()
          seq()
          return
        }
      }
      if (name === 'g' && Object.keys(o.bindings ?? {}).some((k) => k.startsWith('g '))) {
        pendingG.current = true
        return
      }
      if (name === 'j' || name === 'k') {
        const next = step(o.ids, o.selectedId, name === 'j' ? 1 : -1)
        if (next !== undefined) {
          e.preventDefault()
          o.onSelect(next)
        }
        return
      }
      if (name === 'enter' && o.onOpen && o.selectedId) {
        e.preventDefault()
        o.onOpen(o.selectedId)
        return
      }
      const fn = o.bindings?.[name]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
