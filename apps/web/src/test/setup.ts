import '@testing-library/jest-dom/vitest'
import { transferableAbortController } from 'node:util'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom swaps in its own AbortController, but `fetch` and `Request` stay Node's and refuse a foreign signal
// ("Expected signal to be an instance of AbortSignal"): every query or stream passing one would fail, as no browser does.
const node = transferableAbortController()
globalThis.AbortController = node.constructor as typeof AbortController
globalThis.AbortSignal = node.signal.constructor as typeof AbortSignal

// jsdom does not implement it, and the router's scroll restoration calls it on every navigation.
window.scrollTo = () => undefined

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
