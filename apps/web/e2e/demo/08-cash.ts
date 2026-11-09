/**
 * Step 10a: Cash as Dr. Morgan.
 * Owner: d1-rest. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'
import { nav, switchUser } from './shared'

/** Inherits: Thursday 7:10 AM. Leaves Dr. Morgan signed in for 10b. */
export async function step10a(page: Page) {
  await test.step('10a · Cash as Dr. Morgan (days in A/R 26 with its formula, write-offs, estimate)', async () => {
    await switchUser(page, 'usr_morgan')
    await nav(page, /Cash/).click()
    const days = page.locator('[data-kpi="days_in_ar"]')
    await expect(days).toContainText('26') // the API's Thursday number: 27 on Wednesday, before the night's six paid claims
    await expect(days).toContainText('= (insurance A/R + patient A/R) ÷ average daily net production (90 d)')
    await expect(page.getByRole('region', { name: 'Write-offs by type' })).toBeVisible()
    await expect(page.getByTestId('agent-impact')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Agent impact' })).toContainText('estimate')
  })
}
