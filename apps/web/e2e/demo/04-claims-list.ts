/**
 * Step 5: a strip tile → the filtered claims list; refresh keeps it; keyboard opens a claim.
 * Owner: d1-rest. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'

/** Inherits: any page with the main nav, Dana signed in, Denied 5. */
export async function step5(page: Page) {
  await test.step('5 · Denied 5 tile → /claims?status=denied; refresh keeps it; j j enter opens Webb; back', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Inbox/ }).click()
    await page.getByRole('region', { name: 'Claim pipeline' }).getByRole('link', { name: 'Denied 5', exact: true }).click()
    await expect(page).toHaveURL(/\/claims\?status=denied$/)
    const table = page.getByRole('table', { name: 'Claims' })
    await expect(table.locator('[role="row"][data-row-id]')).toHaveCount(5)
    await page.reload()
    await expect(page).toHaveURL(/\/claims\?status=denied$/)
    await expect(table.locator('[role="row"][data-row-id]')).toHaveCount(5)
    await page.locator('body').press('j')
    await page.locator('body').press('j')
    await expect(page).toHaveURL(/row=clm_4733/)
    await page.locator('body').press('Enter')
    await expect(page).toHaveURL(/\/claims\/clm_4733/)
    await expect(page.getByRole('heading', { name: 'Claim #4733' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/claims\?status=denied/)
  })
}
