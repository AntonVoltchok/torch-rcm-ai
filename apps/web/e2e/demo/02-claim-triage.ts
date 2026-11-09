/**
 * Step 3b: live triage from the claim page.
 * Owner: d1-claim-denials. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'

/** Inherits: the Inbox after the group approve (badge 8). */
export async function step3b(page: Page) {
  const badge = page.getByTestId('badge-inbox')
  await test.step('3b · live triage on #4744: reads, label, verdict; one new item; badge 9', async () => {
    const search = page.getByLabel('Search claims and patients')
    await search.fill('4744')
    await search.press('Enter')
    await expect(page).toHaveURL(/\/claims\?q=4744/)
    await page.getByRole('row').filter({ hasText: '#4744' }).click()
    await expect(page.getByRole('heading', { name: 'Claim #4744' })).toBeVisible()
    // D1: the history as party lanes, ending on whose move it is now.
    await expect(page.getByRole('group', { name: 'History by party' }).locator('li[data-now]')).toHaveCount(1)
    await page.getByRole('button', { name: /Ask Follow-up to look/ }).click()
    const panel = page.getByRole('region', { name: 'Agent progress' })
    await expect(panel.getByText('↳ read portal correspondence 10/22')).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText(/payer asks for missing-tooth history/)).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText('Policy: ask Dana → Inbox')).toBeVisible()
    await expect(panel.getByText(/recorded agent plan|live agent/)).toBeVisible()
    await expect(panel.locator('[data-step="report"]')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(badge).toHaveText('9')
    await expect(page.getByRole('region', { name: 'Open inbox items' })).toContainText('records request')
  })
}
