/**
 * Runs this tab started (Approve, Approve 3, Ask Follow-up to look).
 *
 * Run *state* is server data in `['run', id]`, fed by SSE. What lives here is only the tab's memory of
 * which runs it launched, so the Inbox can show "Runs you started" after you navigate away and back, and
 * a reload mid-run can re-open the panel and resubscribe. sessionStorage: per tab, survives reload.
 */
import { useSyncExternalStore } from 'react'
import { readJson, writeJson } from '@/lib/storage'

export interface LaunchedRun {
  run_id: string
  claim_id: string | null
  item_id: string | null
  /** "#4821 K. Owens" — copied from the item/claim at launch so the panel needs no extra fetch. */
  label: string
}

export interface Launch {
  id: string
  kind: 'approve' | 'approve_group' | 'triage'
  title: string
  runs: LaunchedRun[]
  started_at: string // server clock at launch
}

const KEY = 'torch.launches'
const isLaunch = (v: unknown): v is Launch => typeof v === 'object' && v !== null && 'runs' in v && Array.isArray((v as Launch).runs)
let launches: Launch[] = readJson<Launch[]>(KEY, (raw) => (Array.isArray(raw) ? raw.filter(isLaunch) : []), [], 'session')
const listeners = new Set<() => void>()

function commit(next: Launch[]) {
  launches = next.slice(-6)
  writeJson(KEY, launches, 'session')
  listeners.forEach((l) => {
    l()
  })
}

export const launchStore = {
  get: () => launches,
  add(launch: Launch): void {
    commit([...launches.filter((l) => l.id !== launch.id), launch])
  },
  remove(id: string): void {
    commit(launches.filter((l) => l.id !== id))
  },
  clear(): void {
    commit([])
  },
  find: (id: string | undefined) => (id ? launches.find((l) => l.id === id) : undefined),
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useLaunches(): Launch[] {
  return useSyncExternalStore(launchStore.subscribe, launchStore.get, launchStore.get)
}
