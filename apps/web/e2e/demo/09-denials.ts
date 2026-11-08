/**
 * Step 10b: the Denials worklist by next action and Ito's formal appeal.
 * Owner: d1-claim-denials. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'
import { nav } from './shared'

/** Inherits: Thursday 7:10 AM, Dr. Morgan signed in (from 10a). */
export async function step10b(page: Page) {
  await test.step('10b · Denials by next action, Ito’s formal appeal', async () => {
    await nav(page, /Denials/).click()
    const list = page.getByRole('table', { name: 'Denials worklist' })
    const formal = list.getByRole('rowgroup', { name: /Formal appeal/ })
    const ito = formal.locator('tr[data-claim-number="4796"]')
    await expect(ito).toContainText('Formal appeal')
    await expect(ito).toContainText('Dr. Lee signs')
    await expect(ito).toContainText('patient authorization required (ERISA)')
    await expect(ito).toContainText('patient cannot be billed')
    await expect(page.getByRole('complementary', { name: 'Payer × reason' })).toBeVisible()
    await ito.getByRole('link', { name: 'Appeal workbench →' }).click()
    await expect(page).toHaveURL(/\/denials\/clm_4796/)
    await expect(page.getByText('Designed, not built in this demo.')).toBeVisible()
  })
}
