import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { createMockApi } from '@/mocks/node'
import { renderApp } from '@/test/render'

const api = createMockApi({ stepDelayMs: 5 })
beforeAll(() => api.server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => api.reset())
afterAll(() => api.server.close())

const approveUrl = /\/inbox\/itm_4705:approve$/
const list = () => screen.getByRole('list', { name: 'Inbox items' })
const row = (id: string) => list().querySelector(`[data-item-id="${id}"]`)

async function openBrooks() {
  renderApp('/inbox?item=itm_4705')
  await screen.findByRole('article', { name: /#4705/ })
  await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('12'))
  expect(row('itm_4705')).not.toBeNull()
}

describe('Inbox approve', () => {
  it('removes the item optimistically, then takes the badge from meta.counts', async () => {
    // Hold the request so the optimistic state is observable; falling through reaches the mock API.
    api.server.use(http.post(approveUrl, async () => {
      await delay(150)
    }))
    const user = userEvent.setup()
    await openBrooks()
    await user.click(within(screen.getByRole('article', { name: /#4705/ })).getByRole('button', { name: /Approve & run/ }))

    await waitFor(() => expect(row('itm_4705')).toBeNull())
    expect(screen.getByTestId('badge-inbox')).toHaveTextContent('12') // counts are the server's: unchanged until it answers

    await waitFor(() => expect(screen.getByTestId('badge-inbox')).toHaveTextContent('11'))
    expect(await screen.findByRole('region', { name: 'Agent progress' })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /Approve & run/ }))
    await waitFor(() => expect(row('itm_4705')).not.toBeNull())
    // Selection moved on optimistically; go back to the item to see the swapped action.
    await user.click(row('itm_4705') as HTMLElement)
    expect(await screen.findByRole('button', { name: 'Corrected claim (tier 2)' })).toBeInTheDocument()
  })

  it('shows the root-cause guard reason when "Always auto-run" is refused', async () => {
    const user = userEvent.setup()
    renderApp('/inbox?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment')
    await screen.findByRole('article', { name: /#4821/ })
    await user.click(screen.getByRole('button', { name: /Always auto-run/ }))
    expect(await screen.findByTestId('guard-reason')).toHaveTextContent(/Root cause is ours/)
  })

  it('renders the three evidence kinds for #4821', async () => {
    renderApp('/inbox?item=itm_4821&group=delta_ny%3Aresubmit_with_attachment')
    const article = await screen.findByRole('article', { name: /#4821/ })
    await waitFor(() => expect(article.querySelectorAll('[data-evidence-kind]')).toHaveLength(3))
    expect([...article.querySelectorAll('[data-evidence-kind]')].map((e) => e.getAttribute('data-evidence-kind'))).toEqual(['portal_screenshot', 'pms_record', 'era_line'])
    expect(within(article).getByText(/23 of 25/)).toBeInTheDocument()
    expect(within(article).getByTestId('audit-note')).toHaveTextContent('root cause: ours')
  })
})
