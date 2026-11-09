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
  await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('12'))
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
    api.server.use(http.post(approveUrl, async () => {
      await held
    }))
    const user = userEvent.setup()
    await openBrooks()
    await user.click(within(await decision('4705')).getByRole('button', { name: SEND }))

    await waitFor(() => expect(row('itm_4705')).toBeNull())
    expect(screen.getByTestId('badge-inbox')).toHaveTextContent('12') // counts are the server's: unchanged until it answers
    release()

    await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('11'), { timeout: 3000 })
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
    expect(screen.getByTestId('badge-inbox')).toHaveTextContent('12')
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

  it('shows the root-cause guard reason when "Always auto-run" is refused', async () => {
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment')
    await screen.findByRole('article', { name: /#4821/ })
    await user.click(screen.getByRole('button', { name: 'Propose always auto-run' }))
    expect(await screen.findByTestId('guard-reason')).toHaveTextContent(/Root cause is ours/)
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
    expect([...article.querySelectorAll('[data-evidence-kind]')].map((e) => e.getAttribute('data-evidence-kind'))).toEqual(['portal_screenshot', 'pms_record', 'era_line', 'ivr_transcript', 'rep_call'])
    expect(within(article).getByTestId('track-record')).toHaveTextContent(/92%\s*23 of 25/)
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

  it('after Approve the run owns the pane: steps live, then the server\'s changes, then Next', async () => {
    let served: { key: string; before: number; after: number }[] = []
    api.server.events.on('response:mocked', ({ request, response }) => {
      if (approveUrl.test(request.url)) void response.clone().json().then((b: { changes: typeof served }) => (served = b.changes))
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
    expect(within(pane).getByText(new RegExp(`Stopped\\. ${outage}`))).toBeInTheDocument()
    expect(within(pane).queryByTestId('changes')).toBeNull()
    await user.click(await within(pane).findByRole('button', { name: /^Back to .*#4851/ }))
    const back = await decision('4851')
    expect(back).toHaveAccessibleName(/Run stopped/)
  })
})
