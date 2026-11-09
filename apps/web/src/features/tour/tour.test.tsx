/**
 * The tour against the mock API (MSW serves the same seed shapes the real API does):
 *  - every spotlight step's anchor exists on its screen, except those a "Try it" creates (the run panes);
 *  - step copy states no number it did not get from the server;
 *  - "Hide code" is remembered across reloads;
 *  - the main tour opens on load, and Esc gives the app back.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createMockApi } from '@/mocks/node'
import { renderApp, renderWithProviders } from '@/test/render'
import { launchStore } from '@/state/launches'
import { session } from '@/state/session'
import { TOURS } from './registry'
import { AUTOOPEN, tourStore } from './store'
import { anchorSelector } from './anchors'
import type { Step, Tour } from './types'
import { TourProvider, useTour } from './TourProvider'

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

/** Identifiers and codes, not counts: claim numbers, CARC/RARC, X12 transaction sets, HTTP statuses. */
const LITERALS = new Set(['4821', '4744', '16', '29', '835', '999', '277', '202', '403', '409', '422'])
/** Tier names ("Tier 2", "tier-1", "T2") are the spec's three tiers, not counts. */
const TIER = /\b(?:[Tt]ier[ -]|T)[123]\b/g
/**
 * Spelled-out numbers allowed in copy: "one"/"two" as wording ("one endpoint", "two screens cannot disagree"), and spec
 * constants: nine statuses (CLAUDE.md), three tiers, lanes and acknowledgments. Any other number word fails.
 */
const WORDS = new Set(['one', 'two', 'three', 'nine'])
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|hundred)\b/gi

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
      const text = (clone.textContent ?? '').replace(TIER, '')
      const stray = text.match(/\d+/g)?.filter((d) => !LITERALS.has(d)) ?? []
      expect(stray, `digits outside <Num> in ${t.id}/${s.id}`).toEqual([])
      const words = text.match(NUMBER_WORDS)?.filter((w) => !WORDS.has(w.toLowerCase())) ?? []
      expect(words, `spelled-out numbers in ${t.id}/${s.id}`).toEqual([])
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

describe('Try it and focus', () => {
  beforeEach(() => localStorage.removeItem(AUTOOPEN))

  it('lands focus on Next at every step, so the new card is announced', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    await screen.findByRole('heading', { name: 'Where the data comes from' })
    await waitFor(() => expect(within(screen.getByTestId('tour-card')).getByRole('button', { name: 'Next' })).toHaveFocus())
    await user.keyboard('{ArrowRight}')
    await screen.findByRole('heading', { name: 'The pipeline: nine statuses, one source' })
    await waitFor(() => expect(within(screen.getByTestId('tour-card')).getByRole('button', { name: 'Next' })).toHaveFocus())
  })

  it('a refused approve ends the wait at once with the app’s own message, and Next works again', async () => {
    api.server.use(http.post(/\/inbox:approve-group$/, () => HttpResponse.json({ error: { code: 'claim_busy', message: 'An agent is working this claim.' } }, { status: 409 })))
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4821')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    for (let i = 0; i < 6; i++) await user.keyboard('{ArrowRight}')
    await screen.findByRole('heading', { name: 'Dana decides' })
    const tryBtn = await screen.findByTestId('tour-try')
    await waitFor(() => expect(tryBtn).toBeEnabled())
    await user.click(tryBtn)
    const alert = await screen.findByTestId('tour-try-error', {}, { timeout: 3000 })
    expect(alert.textContent).not.toMatch(/did not open/)
    expect(within(screen.getByTestId('tour-card')).getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('Esc during a Try-it stops it before its next step', async () => {
    let tour: ReturnType<typeof useTour> | null = null
    const Grab = () => {
      tour = useTour()
      return null
    }
    // A probe inside a bare provider reads its API; the run below has no screen to press.
    renderWithProviders(
      <TourProvider>
        <Grab />
      </TourProvider>,
    )
    await waitFor(() => expect(tour).not.toBeNull())
    const switched: string[] = []
    const step: Step = {
      id: 't',
      title: 't',
      body: () => null,
      tryIt: {
        label: 't',
        busy: 't',
        then: 'stay',
        run: async (ctx) => {
          await ctx.until(() => false, 5000, 'never')
          await ctx.switchUser('usr_morgan')
          switched.push('morgan')
        },
      },
    }
    let result: unknown
    act(() => {
      void tour?.runTry(step).then((r) => (result = r))
    })
    act(() => tour?.exit())
    await waitFor(() => expect(result).toEqual({ aborted: true }))
    expect(switched).toEqual([])
    expect(session.get().userId).toBe('usr_dana')
  })

  it('a click on the shade explains why the app is paused instead of doing nothing', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    await screen.findByTestId('tour-card')
    await user.click(screen.getByTestId('tour-shield'))
    expect(await screen.findByTestId('tour-nudge')).toHaveTextContent('The app is paused while the tour is open.')
  })
})
