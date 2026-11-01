/** Transient notifications. UI-only state; nothing here is data. */
import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  tone: 'info' | 'ok' | 'warn' | 'bad'
  message: string
  action?: { label: string; href: string }
}

let seq = 0
let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => {
  listeners.forEach((l) => {
    l()
  })
}

export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): void {
  const t: Toast = { id: ++seq, tone: opts.tone ?? 'info', message, ...(opts.action ? { action: opts.action } : {}) }
  toasts = [...toasts.slice(-3), t]
  emit()
  setTimeout(() => {
    dismiss(t.id)
  }, 6000)
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const get = () => toasts

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, get, get)
}
