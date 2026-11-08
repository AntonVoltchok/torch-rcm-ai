/**
 * Step 4: from the completed run in the Inbox to the claim's whole story.
 * Owner: d1-inbox. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'

/** Inherits: Claim #4744 open after triage; the Approve 3 launch in “Runs you started”. */
export async function step4(page: Page) {
  await test.step('4 · back to the Inbox, open #4821 from the completed run: whole story, nothing open, resubmit queued', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Inbox/ }).click()
    await page.getByRole('region', { name: 'Runs you started' }).getByRole('button', { name: /Approve 3/ }).click()
    await page.getByRole('link', { name: 'Open claim #4821 →' }).click()
    await expect(page.getByRole('heading', { name: 'Claim #4821' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: '‹ Inbox' })).toBeVisible()
    await expect(page.getByTestId('no-open-items')).toContainText('resubmit queued · leaves 11:15')
    const timeline = page.getByRole('region', { name: 'Timeline' })
    await expect(timeline).toContainText('built claim #4821 at checkout')
    await expect(timeline).toContainText('BWX NEA# 47720913')
    await expect(timeline).toContainText('root cause: ours')
    await expect(timeline.locator('li[data-lane]').last()).toContainText('resubmit with the NEA#')
  })
}
