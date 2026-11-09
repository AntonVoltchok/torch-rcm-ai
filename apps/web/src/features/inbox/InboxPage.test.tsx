import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { createMockApi } from '@/mocks/node'
import { renderApp } from '@/test/render'
import { launchStore } from '@/state/launches'

const api = createMockApi({ stepDelayMs: 5 })
beforeAll(() => api.server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  api.reset()
  launchStore.clear()
})
afterAll(() => api.server.close())

const approveUrl = /\/inbox\/itm_4705:approve$/
const list = () => screen.getByRole('list', { name: 'Inbox items' })
const row = (id: string) => list().querySelector(`[data-item-id="${id}"]`)
const decision = (n: string) => screen.findByRole('article', { name: new RegExp(`#${n}`) })
/** #4705's action in the server's words (`action_label`). */
const SEND = /Send prompt-pay request/

async function openBrooks() {
  renderApp('/inbox?item=itm_4705')
  await screen.findByRole('article', { name: /#4705/ })
  await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('11'))
  expect(row('itm_4705')).not.toBeNull()
}

describe('Inbox approve', () => {
  it('removes the item optimistically, then takes the badge from meta.counts', async () => {
    // Hold the request until released, so the optimistic state is observable however slow the machine; then fall
    // through to the mock API. (A fixed delay made this flaky under a parallel `make test` + Playwright run.)
    let release = () => {}
    const held = new Promise<void>((r) => {
      release = r
    })
    api.server.use(
      http.post(approveUrl, async () => {
        await held
      }),
    )
    const user = userEvent.setup()
    await openBrooks()
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))

    await waitFor(() => expect(row('itm_4705')).toBeNull())
    expect(screen.getByTestId('badge-inbox')).toHaveTextContent('11') // counts are the server's: unchanged until it answers
    release()

    await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('10'), { timeout: 3000 })
    expect(await screen.findByRole('region', { name: 'Agent progress' }, { timeout: 3000 })).toBeInTheDocument()
    expect(row('itm_4705')).toBeNull()
  })

  it('rolls the item back when the server refuses', async () => {
    api.server.use(
      http.post(approveUrl, async () => {
        await delay(100)
        return HttpResponse.json({ error: { code: 'internal', message: 'boom' } }, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    await openBrooks()
    await user.keyboard('a')

    await waitFor(() => expect(row('itm_4705')).toBeNull())
    await waitFor(() => expect(row('itm_4705')).not.toBeNull())
    expect(await screen.findByText(/Approval failed; nothing was sent/)).toBeInTheDocument()
    expect(screen.getByTestId('badge-inbox')).toHaveTextContent('11')
    expect(screen.queryByRole('region', { name: 'Agent progress' })).toBeNull()
  })

  it('swaps the primary action to a corrected claim on 409 file_departed', async () => {
    api.db.departFile('itm_4705', '10:45')
    const user = userEvent.setup()
    await openBrooks()
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))
    await waitFor(() => expect(row('itm_4705')).not.toBeNull())
    // Selection moved on optimistically; go back to the item to see the swapped action.
    await user.click(row('itm_4705') as HTMLElement)
    expect(await screen.findByRole('button', { name: 'Build a corrected claim' })).toBeInTheDocument()
  })

  it('says up front when a rule can never learn to run alone, and offers the proposal only when it can', async () => {
    renderApp('/inbox?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment')
    const pa = await screen.findByRole('article', { name: /#4821/ })
    expect(within(pa).getByTestId('guard-reason')).toHaveTextContent(/Root cause: ours/)
    expect(within(pa).queryByRole('button', { name: 'Propose always auto-run' })).toBeNull()
    api.reset()
    renderApp('/inbox?item=itm_4705')
    const brooks = await decision('4705')
    expect(within(brooks).getByTestId('policy')).toHaveTextContent('Nothing changes until the proposal is accepted.')
    expect(within(brooks).getByRole('button', { name: 'Propose always auto-run' })).toBeEnabled()
  })

  it('heads the pane with the server’s headline, the title above it', async () => {
    renderApp('/inbox?item=itm_4705')
    const article = await decision('4705')
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent("MetLife hasn't paid in 64 days, past the prompt-pay limit")
    expect(within(article).getByTestId('decision-title')).toHaveTextContent('#4705')
  })

  it('on 409 claim_busy says the server’s words, refetches, and the fresh move locks Approve', async () => {
    const user = userEvent.setup()
    await openBrooks()
    const claimId = api.db.inbox({}).items.find((i) => i.id === 'itm_4705')?.claim?.id ?? ''
    api.db.holdRun(claimId) // another tab, or a scheduled status check: this tab's list does not know yet
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))
    expect(await screen.findByText('Agents are working on #4705. Approve again when they finish.')).toBeInTheDocument()
    await waitFor(() => expect(row('itm_4705')).not.toBeNull())
    await user.click(row('itm_4705') as HTMLElement)
    const article = await decision('4705')
    await waitFor(() => expect(within(article).getByRole('button', { name: SEND })).toBeDisabled())
    expect(within(article).getByTestId('locked')).toHaveTextContent('With the agents')
  })

  it('shows the words of a review draft, each sentence with its evidence', async () => {
    renderApp('/inbox?item=itm_4733')
    const article = await screen.findByRole('article', { name: /#4733/ })
    const sentences = await within(article).findAllByTestId('draft-segment')
    expect(sentences).toHaveLength(3)
    expect(sentences[1]).toHaveTextContent('Delta’s 03/08/2022 EOB shows the prior crown on tooth #31.')
    expect(sentences[1]?.querySelector('cite')).not.toBeNull()
    expect(sentences[2]?.querySelector('cite')).toBeNull()
  })

  it('says why an item stopped at a person', async () => {
    renderApp('/inbox?item=itm_4611')
    const article = await screen.findByRole('article', { name: /#4611/ })
    expect(within(article).getByTestId('stopped-by')).toHaveTextContent('Tier 3 is human only')
  })

  it('renders every evidence kind for #4821', async () => {
    renderApp('/inbox?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment')
    const article = await screen.findByRole('article', { name: /#4821/ })
    await waitFor(() => expect(article.querySelectorAll('[data-evidence-kind]')).toHaveLength(5))
    expect([...article.querySelectorAll('[data-evidence-kind]')].map((e) => e.getAttribute('data-evidence-kind'))).toEqual([
      'portal_screenshot',
      'pms_record',
      'era_line',
      'ivr_transcript',
      'rep_call',
    ])
    const record = within(article).getByTestId('track-record')
    expect(record.querySelector('strong')).toHaveTextContent(/^23 of 25$/) // bolded from k and n, not parsed from the basis
    expect(record).toHaveTextContent('23 of 25 Delta CO-16 · N29 denials paid within 30 days after a PA resubmit (12 mo) (92%)')
    expect(within(article).getByTestId('audit-note')).toHaveTextContent('root cause: ours')
  })

  it('locks Approve only for an item on a claim under a running launch; A says why', async () => {
    const claimId = api.db.inbox({}).items.find((i) => i.id === 'itm_4705')?.claim?.id ?? ''
    // A run this tab launched that the server has not reported as ended (unknown counts as running).
    launchStore.add({ id: 'run_held', kind: 'approve', title: 'Held', runs: [{ run_id: 'run_held', claim_id: claimId, item_id: null, label: '#4705' }], started_at: '' })
    const user = userEvent.setup()
    await openBrooks()
    const article = await decision('4705')
    expect(within(article).getByRole('button', { name: SEND })).toBeDisabled()
    expect(within(article).getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(within(article).getByTestId('locked')).toHaveTextContent('Agents are working on #4705')
    await user.keyboard('a')
    expect(await screen.findByText(/Agents are working on #4705\. This opens when the run ends\./)).toBeInTheDocument()
    expect(row('itm_4705')).not.toBeNull()

    // J moves on, and an item on another claim approves.
    await user.keyboard('j')
    const other = await decision('4851')
    expect(within(other).getByRole('button', { name: /Update ID and resend/ })).toBeEnabled()
  })

  it("after Approve the run owns the pane: steps live, then the server's changes, then Next", async () => {
    let served: { key: string; before: number; after: number }[] = []
    api.server.events.on('response:mocked', ({ request, response }) => {
      if (approveUrl.test(request.url))
        void response
          .clone()
          .json()
          .then((b: { changes: typeof served }) => (served = b.changes))
    })
    const user = userEvent.setup()
    await openBrooks()
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))
    const pane = await screen.findByRole('region', { name: 'Agent progress' }, { timeout: 3000 })
    expect(within(pane).getByRole('heading', { level: 1 })).toHaveTextContent('Send prompt-pay request')
    const changes = await within(pane).findByTestId('changes', {}, { timeout: 5000 })
    expect(served.length).toBeGreaterThan(0)
    const rows = [...changes.querySelectorAll('[data-change]')]
    expect(rows.map((r) => r.getAttribute('data-change'))).toEqual(served.map((c) => c.key))
    for (const [i, c] of served.entries()) {
      expect(rows[i]).toHaveTextContent(c.before === c.after ? `stays ${c.after}` : `${c.before} to ${c.after}`)
    }
    expect(pane.querySelectorAll('[data-step]').length).toBeGreaterThan(0)
    expect([...pane.querySelectorAll('[data-step]')].every((s) => s.getAttribute('data-status') === 'ok')).toBe(true)
    await user.click(within(pane).getByRole('button', { name: /^Next: / }))
    expect(screen.queryByRole('region', { name: 'Agent progress' })).toBeNull()
    expect(await screen.findByRole('article')).toBeInTheDocument()
  })

  it('a failed run says what stopped it in its own words, hides the approve-time changes and leads back to the item it opened', async () => {
    const outage = 'Cigna portal is unreachable. Nothing was changed or sent.'
    api.db.failStep('itm_4851', 'act:compare_pms', outage)
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4851')
    await user.click(within(await decision('4851')).getByRole('button', { name: /Update ID and resend/ }))
    const pane = await screen.findByRole('region', { name: 'Agent progress' }, { timeout: 3000 })
    await waitFor(() => expect(pane).toHaveAttribute('data-failed', 'true'), { timeout: 5000 })
    expect(pane.querySelector('[data-step="act:compare_pms"]')).toHaveAttribute('data-status', 'failed')
    expect(pane.querySelector('[data-step="act:queue_for_file"]')).toHaveAttribute('data-status', 'pending')
    expect(within(pane).getByText(outage, { selector: '[aria-live]' })).toBeInTheDocument()
    expect(within(pane).queryByTestId('changes')).toBeNull()
    await user.click(await within(pane).findByRole('button', { name: /^Back to .*#4851/ }))
    const back = await decision('4851')
    expect(back).toHaveAccessibleName(/Run stopped/)
  })
})

/** Holds a POST until released, then falls through to the mock API (or answers with `refuse`). */
function hold(url: RegExp, refuse?: { status: number; code: string; message: string }) {
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  let answered = false
  api.server.use(
    http.post(url, async () => {
      await held
      answered = true
      if (refuse) return HttpResponse.json({ error: { code: refuse.code, message: refuse.message } }, { status: refuse.status })
    }),
  )
  return { release, answered: () => answered }
}

/**
 * Every decision pane React mounts from now on, read from the DOM's own mutation records, so a pane that is
 * mounted and gone again before the next assertion still counts.
 */
function watchDecisions() {
  const mounted: string[] = []
  const obs = new MutationObserver((records) => {
    for (const r of records)
      for (const n of r.addedNodes) {
        if (!(n instanceof HTMLElement)) continue
        const found = n.matches('[data-testid="decision"]') ? [n] : [...n.querySelectorAll('[data-testid="decision"]')]
        for (const d of found) mounted.push(d.getAttribute('aria-label') ?? '?')
      }
  })
  obs.observe(document.body, { childList: true, subtree: true })
  return { mounted, stop: () => obs.disconnect() }
}

describe('Inbox approve: the run pane opens on the click (final D1 red team, flash)', () => {
  it('shows "Starting…" before the server answers, never the next item, then the same pane takes the steps', async () => {
    const approve = hold(approveUrl)
    const user = userEvent.setup()
    const { router } = renderApp('/inbox?item=itm_4705')
    await screen.findByRole('article', { name: /#4705/ })
    const watch = watchDecisions()
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))

    const pane = await screen.findByRole('region', { name: 'Agent progress' })
    expect(approve.answered()).toBe(false)
    expect(pane).toHaveAttribute('data-starting', 'true')
    expect(within(pane).getByRole('heading', { level: 1 })).toHaveTextContent('Send prompt-pay request')
    expect(within(pane).getByRole('heading', { level: 2 })).toHaveTextContent('Starting…')
    expect(within(pane).getByRole('region', { name: /^Run #4705/ })).toHaveTextContent('Starting…')
    expect(router.state.location.search).toMatchObject({ launch: 'starting' })
    expect(screen.queryByRole('article')).toBeNull()
    expect(launchStore.get()).toHaveLength(0)

    approve.release()
    await waitFor(() => expect(pane.querySelectorAll('[data-step]').length).toBeGreaterThan(0), { timeout: 3000 })
    expect(screen.getByRole('region', { name: 'Agent progress' })).toBe(pane) // the same panel, not a remount
    expect(pane).not.toHaveAttribute('data-starting')
    const launched = launchStore.get()[0]
    await waitFor(() => expect(router.state.location.search).toMatchObject({ launch: launched?.id }))
    watch.stop()
    expect(watch.mounted).toEqual([])
  })

  it('on a refusal returns to the same item with the server’s reason, and leaves nothing launched', async () => {
    const message = 'Only Dr. Morgan can approve this.'
    const approve = hold(approveUrl, { status: 403, code: 'tier_requires_owner', message })
    const user = userEvent.setup()
    const { router } = renderApp('/inbox?item=itm_4705')
    await screen.findByRole('article', { name: /#4705/ })
    const watch = watchDecisions()
    await user.keyboard('a')
    expect(await screen.findByRole('region', { name: 'Agent progress' })).toHaveAttribute('data-starting', 'true')

    approve.release()
    const back = await decision('4705')
    expect(within(back).getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('region', { name: 'Agent progress' })).toBeNull()
    expect(router.state.location.search).toMatchObject({ item: 'itm_4705' })
    expect(router.state.location.search).not.toHaveProperty('launch')
    expect(launchStore.get()).toHaveLength(0)
    expect(row('itm_4705')).not.toBeNull()
    expect(screen.getAllByText(message)).toHaveLength(1) // said once, inline, not also toasted
    watch.stop()
    expect(watch.mounted).toEqual([back.getAttribute('aria-label')]) // only the item it came back to
  })

  it('⇧A opens one Starting pane for the whole batch, then its runs; J/K stay live and leave it', async () => {
    const group = hold(/\/inbox:approve-group$/)
    const user = userEvent.setup()
    const { router } = renderApp('/inbox?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment')
    await screen.findByRole('article', { name: /#4821/ })
    const watch = watchDecisions()
    await user.keyboard('{Shift>}A{/Shift}')

    const pane = await screen.findByRole('region', { name: 'Agent progress' })
    expect(pane).toHaveAttribute('data-starting', 'true')
    const rows = within(pane).getAllByRole('region', { name: /^Run #/ })
    expect(rows).toHaveLength(3) // "Delta Dental · missing PA x-ray (3)": one row per member, before any run exists
    expect(rows.every((r) => r.textContent?.includes('Starting…'))).toBe(true)
    group.release()
    await waitFor(() => expect(pane.querySelectorAll('[data-run]').length).toBe(rows.length), { timeout: 3000 })
    expect(screen.getByRole('region', { name: 'Agent progress' })).toBe(pane)
    watch.stop()
    expect(watch.mounted).toEqual([])

    // J/K leave the run pane as they do during any run; the batch stays under "Runs you started".
    await user.keyboard('j')
    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Agent progress' })).toBeNull()
    expect(router.state.location.search).not.toHaveProperty('launch')
    expect(launchStore.get()).toHaveLength(1)
  })

  it('J while Starting leaves the pane; the 202 then only lists the run and does not pull the pane back', async () => {
    const approve = hold(approveUrl)
    const user = userEvent.setup()
    const { router } = renderApp('/inbox?item=itm_4705')
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))
    expect(await screen.findByRole('region', { name: 'Agent progress' })).toHaveAttribute('data-starting', 'true')
    await user.keyboard('j')
    const other = await screen.findByRole('article')
    expect(screen.queryByRole('region', { name: 'Agent progress' })).toBeNull()
    await user.keyboard('a') // one approval at a time: the key says why it waits
    expect(await screen.findByText(/#4705 .* is starting\. Approve opens when the server answers\./)).toBeInTheDocument()

    approve.release()
    await waitFor(() => expect(launchStore.get()).toHaveLength(1), { timeout: 3000 })
    expect(screen.getByRole('article')).toBe(other)
    expect(screen.queryByRole('region', { name: 'Agent progress' })).toBeNull()
    expect(router.state.location.search).not.toHaveProperty('launch')
  })
})

describe('Inbox counts (final D1 red team #4)', () => {
  it('says how many need you and who the rest wait on; badge, header and the All tab are one number', async () => {
    renderApp('/inbox')
    await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('11'))
    expect(screen.getByText('11 items need you: 8 claims, 3 upcoming visits · 1 waiting on Dr. Morgan')).toBeInTheDocument()
    expect(within(screen.getByRole('tablist', { name: 'Filter' })).getByRole('tab', { name: /All/ })).toHaveTextContent('11')
    const waiting = screen.getByRole('region', { name: 'Waiting on Dr. Morgan' })
    expect(within(waiting).getByRole('heading')).toHaveTextContent('Waiting on Dr. Morgan · 1$1,240')
    expect(waiting.querySelector('[data-item-id="itm_4611"]')).not.toBeNull()
    expect(row('itm_4611')).toBeNull() // not listed as Dana's
  })

  it('shows the unnamed #4744 as having no track record, not the records-request rule’s', async () => {
    api.db.triage('clm_4744', 'usr_dana')
    await waitFor(() => expect(api.db.inbox({}).items.some((i) => i.id === 'itm_4744')).toBe(true), { timeout: 3000 })
    renderApp('/inbox?item=itm_4744')
    const pane = within(await screen.findByTestId('track-record', {}, { timeout: 3000 }))
    expect(pane.getByText(/No track record\. TorchRCM couldn't match this to a known situation/)).toBeInTheDocument()
    expect(pane.queryByText(/%|of 97/)).toBeNull()
  })
})
