/**
 * Browser mock mode (`VITE_USE_MOCKS=1`). The mock DB is persisted to sessionStorage so a page refresh
 * keeps the demo's state (approvals, runs in flight) — the same thing the real API's SQLite gives you.
 * `POST /clock/reset` (or a new tab) starts from the canonical 10:40 state.
 */
import { setupWorker } from 'msw/browser'
import { MockDb } from './db'
import { makeHandlers } from './handlers'

const KEY = 'torch.mockdb.v1'

export async function startMockWorker(): Promise<void> {
  let saved: string | undefined
  try {
    saved = sessionStorage.getItem(KEY) ?? undefined
  } catch {
    saved = undefined
  }
  let pending = false
  const db = new MockDb(
    {
      onChange: (d) => {
        if (pending) return
        pending = true
        queueMicrotask(() => {
          pending = false
          try {
            sessionStorage.setItem(KEY, d.snapshot())
          } catch {
            /* storage full: state just won't survive a reload */
          }
        })
      },
    },
    saved,
  )
  db.resumeRuns()
  await setupWorker(...makeHandlers(db)).start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
    quiet: true,
  })
}
