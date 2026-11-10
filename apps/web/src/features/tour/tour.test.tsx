/**
 * The tour against the mock API (MSW serves the same seed shapes the real API does):
 *  - every spotlight step's anchor exists on its screen, except those a "Try it" creates (the run panes);
 *  - a step that comes before its Try it shows that Try it's control instead of an empty spot (resolveStep);
 *  - a step whose practice state is gone (needs.ts) resets the demo first, once, and only before any mutating Try it;
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
import { resolveStep } from './needs'
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

/**
 * Steps whose own anchor a "Try it" creates (the run panes). Before it runs they show that Try it's control instead
 * (`after`, tested in "needs and after" below); the panes themselves are covered by e2e/tour.spec.ts.
 */
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

  it('Esc after a Try-it switched to Dr. Morgan gives the viewer back (the reset a step runs on its own)', async () => {
    let tour: ReturnType<typeof useTour> | null = null
    const Grab = () => {
      tour = useTour()
      return null
    }
    renderWithProviders(
      <TourProvider>
        <Grab />
      </TourProvider>,
    )
    await waitFor(() => expect(tour).not.toBeNull())
    const step: Step = {
      id: 't',
      title: 't',
      body: () => null,
      tryIt: {
        label: 't',
        busy: 't',
        then: 'stay',
        run: async (ctx) => {
          await ctx.switchUser('usr_morgan')
          await ctx.until(() => false, 5000, 'never')
        },
      },
    }
    let result: unknown
    act(() => {
      void tour?.runTry(step).then((r) => (result = r))
    })
    await waitFor(() => expect(session.get().userId).toBe('usr_morgan'))
    act(() => tour?.exit())
    await waitFor(() => expect(result).toEqual({ aborted: true }))
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

describe('needs and after', () => {
  beforeEach(() => localStorage.removeItem(AUTOOPEN))
  const off: Array<() => void> = []
  afterEach(() => off.splice(0).forEach((f) => f()))

  /** Who made each matching request from now on (the X-Torch-User header); the listener is dropped after the test. */
  const requests = (method: string, path: RegExp) => {
    const seen: Array<string | null> = []
    const on = ({ request }: { request: Request }) => {
      if (request.method === method && path.test(new URL(request.url).pathname)) seen.push(request.headers.get('X-Torch-User'))
    }
    api.server.events.on('request:start', on)
    off.push(() => api.server.events.removeListener('request:start', on))
    return seen
  }
  const next = () => within(screen.getByTestId('tour-card')).getByRole('button', { name: 'Next' })

  it('the run step, before the approve has run, is the decide step’s control and Try it; after it, itself', () => {
    const tour = TOURS.main
    const run = tour.steps.find((s) => s.id === 'run')
    expect(run).toBeDefined()
    if (!run) return
    const before = resolveStep(tour, run, new Set())
    expect(before.anchor).toBe('approve')
    expect(before.tryIt?.mutates).toBe(true)
    expect(before.tryIt?.then).toBe('stay')
    expect(before.waiting).toBe(run.after?.note)
    expect(before.id).toBe('run')
    const after = resolveStep(tour, run, new Set(['decide']))
    expect(after).toBe(run)
    expect(after.anchor).toBe('run-pane')
    expect(after.tryIt).toBeUndefined()
  })

  it('resets the demo before the first step when #4821 has left the Inbox, says why, and keeps Dana signed in', async () => {
    // #4821 reads as approved until the reset, which then serves the seed again (the mock reseeds on POST /clock/reset).
    let approved = true
    api.server.use(
      http.post(/\/clock\/reset$/, () => {
        approved = false
      }),
      http.get(/\/inbox\/itm_4821$/, () => (approved ? HttpResponse.json({ ...api.db.inboxItem('itm_4821'), state: 'approved' }) : undefined)),
    )
    const resets = requests('POST', /\/clock\/reset$/)
    // Signed in as the owner: the main tour switches to Dana, and the reset (a demo control) presses as Dana.
    session.set({ userId: 'usr_morgan' })
    const user = userEvent.setup()
    renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    const card = await screen.findByTestId('tour-preparing')
    expect(card).toHaveTextContent('K. Owens #4821 is approved in this practice’s data')
    await waitFor(() => expect(screen.queryByTestId('tour-preparing')).toBeNull(), { timeout: 15_000 })
    expect(resets).toEqual(['usr_dana'])
    expect(screen.queryByTestId('tour-preparing-error')).toBeNull()
    await screen.findByRole('heading', { name: 'Where the data comes from' })
    expect(session.get().userId).toBe('usr_dana')
    // One reset per tour: the next steps, which need the same state, do not reset again.
    await user.click(next())
    await screen.findByRole('heading', { name: 'The pipeline: nine statuses, one source' })
    expect(resets).toHaveLength(1)
    // Exit gives back the persona the tour started from.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(session.get().userId).toBe('usr_morgan'))
  }, 20_000)

  it('makes no reset when #4821 is open, as it is in the seed', async () => {
    const resets = requests('POST', /\/clock\/reset$/)
    const user = userEvent.setup()
    renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    await screen.findByRole('heading', { name: 'Where the data comes from' })
    await user.click(next())
    await screen.findByRole('heading', { name: 'The pipeline: nine statuses, one source' })
    expect(screen.queryByTestId('tour-preparing')).toBeNull()
    expect(resets).toEqual([])
  })

  it('Next past “Dana decides” without Try it spotlights the approve button and offers its Try it there', async () => {
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4821')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    for (let i = 0; i < 6; i++) await user.keyboard('{ArrowRight}')
    await screen.findByRole('heading', { name: 'Dana decides' })
    await user.click(next())
    await screen.findByRole('heading', { name: 'The approval run' })
    expect(await screen.findByTestId('tour-waiting')).toHaveTextContent('The run starts when Dana approves')
    const tryBtn = await screen.findByTestId('tour-try')
    await waitFor(() => expect(tryBtn).toBeEnabled(), { timeout: 4000 })
    expect(screen.getByTestId('tour-hole')).toBeInTheDocument()
    expect(document.querySelector(anchorSelector('approve'))).not.toBeNull()
    expect(screen.queryByTestId('tour-missing')).toBeNull()
  })

  it('after the tour’s own approve, Back to “Dana decides” does not reset: it says the group was approved', async () => {
    const resets = requests('POST', /\/clock\/reset$/)
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4821')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    for (let i = 0; i < 6; i++) await user.keyboard('{ArrowRight}')
    await screen.findByRole('heading', { name: 'Dana decides' })
    const tryBtn = await screen.findByTestId('tour-try')
    await waitFor(() => expect(tryBtn).toBeEnabled(), { timeout: 4000 })
    await user.click(tryBtn)
    await screen.findByRole('heading', { name: 'The approval run' }, { timeout: 15_000 })
    expect(screen.queryByTestId('tour-waiting')).toBeNull()
    await user.click(within(screen.getByTestId('tour-card')).getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { name: 'Dana decides' })
    expect(await screen.findByTestId('tour-missing', {}, { timeout: 6000 })).toHaveTextContent('Approved in this tour')
    expect(screen.queryByTestId('tour-preparing')).toBeNull()
    expect(resets).toEqual([])
  }, 20_000)
})

describe('“Show tours automatically”', () => {
  beforeEach(() => {
    localStorage.removeItem(AUTOOPEN)
    localStorage.removeItem('torchrcm.tour.seen')
    tourStore.reload()
  })

  it('off from a tour card: no main tour on the next load, no screen tour on a first visit, and a tour still starts by hand', async () => {
    const user = userEvent.setup()
    const first = renderApp('/inbox')
    await user.click(await screen.findByRole('button', { name: 'Start the tour' }))
    const box = within(await screen.findByTestId('tour-card')).getByRole('checkbox', { name: 'Show tours automatically' })
    expect(box).toBeChecked()
    await user.click(box)
    expect(box).not.toBeChecked()
    expect(localStorage.getItem(AUTOOPEN)).toBe('false')
    first.unmount()

    const { router } = renderApp('/inbox')
    await screen.findByRole('button', { name: 'Tour this screen: Inbox' })
    expect(screen.queryByTestId('tour-modal')).toBeNull()
    await act(() => router.navigate({ to: '/denials' }))
    const start = await screen.findByRole('button', { name: 'Tour this screen: Denials' })
    expect(screen.queryByTestId('tour-card')).toBeNull()

    await user.click(start)
    expect(await screen.findByTestId('tour-card')).toBeInTheDocument()
  })

  it('the welcome offers the switch, and the sidebar menu turns it back on', async () => {
    const user = userEvent.setup()
    renderApp('/inbox')
    const modal = await screen.findByTestId('tour-modal')
    await user.click(within(modal).getByRole('checkbox', { name: 'Show tours automatically' }))
    expect(tourStore.autoOpen()).toBe(false)
    await user.click(within(modal).getByRole('button', { name: 'Skip, use the app' }))

    await user.click(screen.getByRole('button', { name: 'All tours' }))
    const item = screen.getByRole('menuitemcheckbox', { name: 'Show tours automatically' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    await user.click(item)
    expect(item).toHaveAttribute('aria-checked', 'true')
    expect(tourStore.autoOpen()).toBe(true)
  })
})
