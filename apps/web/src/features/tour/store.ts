/**
 * What the tour remembers about this browser: which tours were seen, whether code panes are hidden, and whether tours
 * open on their own. localStorage behind try/catch (lib/storage): convenience only, the app never depends on it.
 * Per viewer, not per demo persona: the main tour switches to Dr. Morgan and back, and the pane must not flip.
 */
import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from '@/lib/storage'
import type { TourId } from './types'

const SEEN = 'torchrcm.tour.seen'
const CODE = 'torchrcm.tour.code'
/**
 * `false` turns off both auto-opens (the main tour on load, a screen tour on first visit). The viewer's "Show tours
 * automatically" switch writes it; test suites set it. Read from storage on every call, so a test can clear it.
 */
export const AUTOOPEN = 'torchrcm.tour.autoopen'

const listeners = new Set<() => void>()
const emit = () => {
  listeners.forEach((l) => {
    l()
  })
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const readSeen = (): Partial<Record<TourId, true>> =>
  readJson(SEEN, (raw) => (typeof raw === 'object' && raw !== null ? (raw as Partial<Record<TourId, true>>) : {}), {})

let seen = readSeen()
let codeOpen = readJson(CODE, (raw) => raw !== false, true)

export const tourStore = {
  seen: (id: TourId): boolean => seen[id] === true,
  markSeen(id: TourId): void {
    if (seen[id]) return
    seen = { ...seen, [id]: true }
    writeJson(SEEN, seen)
    emit()
  },
  codeOpen: (): boolean => codeOpen,
  setCodeOpen(open: boolean): void {
    codeOpen = open
    writeJson(CODE, open)
    emit()
  },
  autoOpen: (): boolean => readJson(AUTOOPEN, (raw) => raw !== false, true),
  setAutoOpen(on: boolean): void {
    writeJson(AUTOOPEN, on)
    emit()
  },
  /** Tests: drop the module's copy and read storage again. */
  reload(): void {
    seen = readSeen()
    codeOpen = readJson(CODE, (raw) => raw !== false, true)
    emit()
  },
}

export function useSeen(): Partial<Record<TourId, true>> {
  return useSyncExternalStore(subscribe, () => seen, () => seen)
}

export function useAutoOpen(): boolean {
  return useSyncExternalStore(subscribe, tourStore.autoOpen, tourStore.autoOpen)
}

export function useCodeOpen(): boolean {
  return useSyncExternalStore(subscribe, tourStore.codeOpen, tourStore.codeOpen)
}
