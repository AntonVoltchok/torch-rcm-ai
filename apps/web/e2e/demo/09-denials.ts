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
    // D1: the path is the group's heading ("Next: formal appeal"), not a chip on each row.
    await expect(formal.getByRole('rowheader')).toContainText('Next: formal appeal')
    await expect(ito).toContainText('Dr. Lee signs')
    await expect(ito).toContainText('patient authorization required (ERISA)')
    await expect(ito).toContainText('patient cannot be billed')
    await expect(page.getByRole('complementary', { name: 'Payer × reason' })).toBeVisible()
    // D1 summary: the Denied tile's holders, one tick per claim.
    await expect(page.getByTestId('denials-summary').getByRole('img')).toBeVisible()
    // J/K select (in the URL), Enter opens the claim, Back to Denials returns to the same row.
    await page.keyboard.press('j')
    await expect(page).toHaveURL(/\/denials\?row=clm_/)
    const selected = new URL(page.url()).searchParams.get('row') ?? ''
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/claims/${selected}\\?from=denials`))
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: '‹ Denials' }).click()
    await expect(page).toHaveURL(new RegExp(`/denials\\?row=${selected}`))
    await ito.getByRole('link', { name: 'Appeal workbench →' }).click()
    await expect(page).toHaveURL(/\/denials\/clm_4796/)
    await expect(page.getByText('Designed, not built in this demo.')).toBeVisible()
  })
}
