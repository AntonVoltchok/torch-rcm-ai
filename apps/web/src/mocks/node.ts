/** MSW for Vitest: one server per test file, a fresh MockDb per test. */
import { setupServer } from 'msw/node'
import { MockDb } from './db'
import { makeHandlers } from './handlers'

export function createMockApi(opts: { stepDelayMs?: number } = {}) {
  let db = new MockDb({ stepDelayMs: opts.stepDelayMs ?? 5 })
  const server = setupServer(...makeHandlers(db))
  return {
    server,
    get db() {
      return db
    },
    reset() {
      db = new MockDb({ stepDelayMs: opts.stepDelayMs ?? 5 })
      server.resetHandlers(...makeHandlers(db))
    },
  }
}
