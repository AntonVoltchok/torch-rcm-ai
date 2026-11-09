/** Connection state of the /runs/stream firehose, so queries can fall back to polling when it is down. */
import { useSyncExternalStore } from 'react'

export type FirehoseState = 'connecting' | 'live' | 'down'
let state: FirehoseState = 'connecting'
const listeners = new Set<() => void>()

export const liveStore = {
  get: () => state,
  set(next: FirehoseState) {
    if (next === state) return
    state = next
    listeners.forEach((l) => {
      l()
    })
  },
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useFirehoseState(): FirehoseState {
  return useSyncExternalStore(liveStore.subscribe, liveStore.get, liveStore.get)
}
