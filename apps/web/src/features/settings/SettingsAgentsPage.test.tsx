import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http } from 'msw'
import { createMockApi } from '@/mocks/node'
import { session } from '@/state/session'
import { renderApp } from '@/test/render'

const api = createMockApi({ stepDelayMs: 5 })
beforeAll(() => api.server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  api.reset()
  session.set({ userId: 'usr_dana' })
})
afterAll(() => api.server.close())

const ruleRow = async (id: string) => {
  const table = await screen.findByRole('table', { name: 'Agent rules' })
  await waitFor(() => expect(table.querySelector(`tr[data-rule-id="${id}"]`)).not.toBeNull())
  return table.querySelector(`tr[data-rule-id="${id}"]`) as HTMLElement
}
const checked = (row: HTMLElement) => within(row).getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')?.textContent

describe('Settings › Agents', () => {
  it('renders tier 3 as Human only with no control', async () => {
    session.set({ userId: 'usr_morgan' })
    renderApp('/settings/agents')
    const appeal = await ruleRow('rule_t3_formal_appeal')
    expect(within(appeal).getByTestId('human-only')).toHaveTextContent('Human only')
    expect(within(appeal).queryByRole('radiogroup')).toBeNull()
  })

  it('flips the mode optimistically, then keeps the server’s answer', async () => {
    api.server.use(http.patch(/\/rules\/rule_t1_status_check$/, async () => {
      await delay(150)
    }))
    const user = userEvent.setup()
    renderApp('/settings/agents')
    const row = await ruleRow('rule_t1_status_check')
    expect(checked(row)).toBe('Ask Dana')
    await user.click(within(row).getByRole('radio', { name: 'Runs without review' }))
    expect(checked(row)).toBe('Runs without review') // before the server answers
    await waitFor(() => expect(api.db.rules().tiers[0]?.rows.find((r) => r.rule.id === 'rule_t1_status_check')?.rule.mode).toBe('auto'))
    expect(checked(await ruleRow('rule_t1_status_check'))).toBe('Runs without review')
  })

  it('on 409 owner_signoff_required reverts, says where it went, and Dr. Morgan’s queue grows', async () => {
    const user = userEvent.setup()
    renderApp('/settings/agents')
    const era = await ruleRow('rule_t2_post_era')
    expect(within(era).getByText('Needs Dr. Morgan')).toBeInTheDocument()
    await user.click(within(era).getByRole('radio', { name: 'Ask Dana' }))
    expect(await screen.findByText('Sent to Dr. Morgan for sign-off')).toBeInTheDocument()
    await waitFor(async () => expect(checked(await ruleRow('rule_t2_post_era'))).toBe('Runs without review'))
    expect(api.db.strip(undefined, 'usr_dana').inbox_open).toBe(12)
    expect(api.db.strip(undefined, 'usr_morgan').inbox_open).toBe(13)
  })

  it('previews on hover: the Delta rule without review reads 41 → 44 of 53, 3 held (ours)', async () => {
    const user = userEvent.setup()
    renderApp('/settings/agents')
    const delta = await ruleRow('rule_t1_delta_pa')
    await user.hover(within(delta).getByRole('radio', { name: 'Runs without review' }))
    const preview = screen.getByRole('region', { name: 'Live preview' })
    expect(await within(preview).findByTestId('preview-numbers')).toHaveTextContent('41 → 44')
    expect(within(preview).getByTestId('preview-held')).toHaveTextContent('3 of the 44 are root cause: ours')
  })

  it('keeps Accept disabled on the root-cause guard card, with the reason', async () => {
    renderApp('/settings/agents?tab=proposals')
    const card = await screen.findByRole('article', { name: /when our Claims agent attached the wrong image/ })
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(within(card).getByTestId('proposal-blocked')).toHaveTextContent('root cause: ours')
  })
})
