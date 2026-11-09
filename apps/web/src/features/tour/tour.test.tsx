/**
 * The tour against the mock API (MSW serves the same seed shapes the real API does):
 *  - every spotlight step's anchor exists on its screen, except those a "Try it" creates (the run panes);
 *  - step copy states no number it did not get from the server;
 *  - "Hide code" is remembered across reloads;
 *  - the main tour opens on load, and Esc gives the app back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMockApi } from '@/mocks/node'
import { renderApp, renderWithProviders } from '@/test/render'
import { launchStore } from '@/state/launches'
import { session } from '@/state/session'
import { TOURS } from './registry'
import { AUTOOPEN, tourStore } from './store'
import { anchorSelector } from './anchors'
import type { Step, Tour } from './types'

const api = createMockApi({ stepDelayMs: 5 })
beforeAll(() => api.server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => {
  session.set({ userId: 'usr_dana', locationId: 'all' })
  tourStore.reload()
})
afterEach(() => {
  api.reset()
  launchStore.clear()
})
afterAll(() => api.server.close())

/** Anchors that only exist after the step before them pressed "Try it" (covered by e2e/tour.spec.ts). */
const AFTER_TRY = new Set(['main/run', 'claim/run'])

const stepUrl = (t: Tour, s: Step) => {
  const r = s.route ?? { to: t.home }
  const q = r.search ? `?${new URLSearchParams(Object.entries(r.search).map(([k, v]) => [k, String(v)])).toString()}` : ''
  return `${r.to}${q}`
}

describe('anchors', () => {
  const groups = new Map<string, { tour: Tour; steps: Step[] }>()
  for (const t of Object.values(TOURS))
    for (const s of t.steps) {
      if (s.modal || AFTER_TRY.has(`${t.id}/${s.id}`) || s.searchFrom) continue
      const url = stepUrl(t, s)
      const key = `${t.id === 'cash' ? 'morgan' : 'dana'} ${url}`
      const g = groups.get(key) ?? { tour: t, steps: [] }
      g.steps.push(s)
      groups.set(key, g)
    }

  for (const [key, g] of groups) {
    it(`${key}: ${g.steps.map((s) => s.anchor).join(', ')}`, async () => {
      if (key.startsWith('morgan')) session.set({ userId: 'usr_morgan' })
      renderApp(key.slice(key.indexOf(' ') + 1))
      for (const s of g.steps) {
        await waitFor(() => expect(document.querySelector(anchorSelector(s.anchor ?? '')), `${g.tour.id}/${s.id} → ${s.anchor}`).not.toBeNull(), { timeout: 4000 })
      }
    })
  }

  it('eligibility: the benefits card opens on the flagged appointment the server names', async () => {
    const user = userEvent.setup()
    localStorage.removeItem(AUTOOPEN)
    const { router } = renderApp('/eligibility')
    await user.click(await screen.findByRole('button', { name: 'Skip, use the app' }))
    await user.click(screen.getByRole('button', { name: /Tour this screen: Eligibility/ }))
    // Each step is a fresh card, so look it up again after every Next.
    await user.click(within(await screen.findByTestId('tour-card')).getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'A flag with its reason' })
    await user.click(within(screen.getByTestId('tour-card')).getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'The benefits card' })
    await waitFor(() => expect(router.state.location.search).toHaveProperty('appt'), { timeout: 4000 })
    await waitFor(() => expect(document.querySelector(anchorSelector('benefits'))).not.toBeNull(), { timeout: 4000 })
  })
})

/** Identifiers and codes, not counts: claim numbers, CARC/RARC, X12 transaction sets, HTTP statuses, tier numbers. */
const LITERALS = new Set(['4821', '4744', '16', '29', '835', '999', '277', '202', '403', '409', '422', '1', '2', '3'])

describe('numbers in step copy', () => {
  const all = Object.values(TOURS).flatMap((t) => t.steps.map((s) => ({ t, s })))
  for (const { t, s } of all) {
    it(`${t.id}/${s.id} states only server numbers`, async () => {
      if (t.id === 'cash') session.set({ userId: 'usr_morgan' })
      const Body = s.body
      const { container } = renderWithProviders(<Body />)
      // Every <Num> resolves (none still reads "…"), so the check sees real values, not placeholders.
      await waitFor(() => expect([...container.querySelectorAll('[data-server-number]')].map((n) => n.textContent)).not.toContain('…'), { timeout: 4000 })
      const clone = container.cloneNode(true) as HTMLElement
      clone.querySelectorAll('[data-server-number]').forEach((n) => n.remove())
      const stray = (clone.textContent ?? '').match(/\d+/g)?.filter((d) => !LITERALS.has(d)) ?? []
      expect(stray, `digits outside <Num> in ${t.id}/${s.id}`).toEqual([])
    })
  }
})

describe('the tour in the app', () => {
  beforeEach(() => localStorage.removeItem(AUTOOPEN))

  it('opens the main tour on load; Esc gives the app back and the shell is interactive again', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    const modal = await screen.findByTestId('tour-modal')
    expect(within(modal).getByRole('heading', { name: 'Welcome to TorchRCM' })).toBeInTheDocument()
    expect(document.querySelector('[inert]')).not.toBeNull()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('tour-modal')).toBeNull())
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('remembers “Hide code” across reloads', async () => {
    const user = userEvent.setup()
    const first = renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    const card = await screen.findByTestId('tour-card')
    expect(within(card).getByTestId('tour-code')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Hide code' }))
    expect(within(card).queryByTestId('tour-code')).toBeNull()
    expect(localStorage.getItem('torchrcm.tour.code')).toBe('false')
    first.unmount()

    tourStore.reload()
    renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    const again = await screen.findByTestId('tour-card')
    expect(within(again).getByRole('button', { name: 'Show code' })).toBeInTheDocument()
    expect(within(again).queryByTestId('tour-code')).toBeNull()
  })

  it('keeps the app’s own shortcuts quiet while a tour is up', async () => {
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4705')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    await screen.findByTestId('tour-card')
    const approves: string[] = []
    api.server.events.on('request:start', ({ request }) => {
      if (request.method === 'POST') approves.push(request.url)
    })
    await user.keyboard('a')
    await user.keyboard('{Shift>}A{/Shift}')
    expect(approves).toEqual([])
  })
})
