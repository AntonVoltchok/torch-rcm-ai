/**
 * Step 9: Activity filtered to Follow-up; Observe-mode preview.
 * Owner: d1-rest. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'
import { nav } from './shared'

/** Inherits: Thursday 7:10 AM, Dana signed in. */
export async function step9(page: Page) {
  await test.step('9 · Activity → Follow-up rows with evidence; Observe-mode preview styles them “would have run”', async () => {
    await nav(page, /Activity/).click()
    await page.getByLabel('Agent').selectOption('followup')
    await expect(page).toHaveURL(/agent=followup/)
    const log = page.getByRole('table', { name: 'Activity' })
    await expect(log.locator('tr[data-run-id]').filter({ hasText: 'IVR transcript' }).first()).toBeVisible()
    await expect(log.locator('tr[data-run-id]').filter({ hasText: 'DD-1027-88412' }).first()).toContainText('rep call')
    await page.getByLabel('Observe mode preview').check()
    await expect(page).toHaveURL(/observe=true/)
    await expect(log.locator('tr[data-style="observe_preview"]').first()).toContainText('would have run')
  })
}
