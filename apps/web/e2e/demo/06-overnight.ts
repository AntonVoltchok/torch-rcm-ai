/**
 * Step 8: skip to Thursday 7:10 AM; the Inbox, strip and nav badges after the night.
 * Owner: d1-rest. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'
import { nav, switchUser } from './shared'

/** Inherits: Dr. Morgan signed in after step 7. */
export async function step8(page: Page) {
  const badge = page.getByTestId('badge-inbox')
  const strip = page.getByRole('region', { name: 'Claim pipeline' })
  await test.step('8 · ⏭ Skip to Thu 7:10 AM: async progress, then 14 need Dana, 1 waits on Dr. Morgan and 2 on Dr. Lee, the strip, the nav badges', async () => {
    const clock = page.getByTestId('clock-control')
    await clock.getByRole('button', { name: /Skip to Thu 7:10 AM/ }).click()
    await expect(clock.getByRole('button', { name: /Skip to/ })).toBeDisabled()
    await expect(clock.getByTestId('advance-progress')).toBeVisible()
    await expect(clock.getByTestId('advance-progress')).toBeHidden({ timeout: 60_000 })
    await expect(clock).toContainText('Thu Oct 29 · 7:10 AM')
    await switchUser(page, 'usr_dana')
    await nav(page, /Inbox/).click()
    // A queue of 17 (9 + Diaz after step 3b, 4 overnight denials, 3 status-check proposals): Diaz still waits on
    // Dr. Morgan (owner), and the Ito and Morris formal appeals wait on Dr. Lee, the dentist who treated both.
    await expect(badge).toHaveText('14')
    await expect(page.getByText(/^14 items need you: .* · 1 waiting on Dr\. Morgan · 2 waiting on Dr\. Lee$/)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Waiting on Dr. Lee' })).toContainText('#4796')
    await expect(page.getByRole('region', { name: 'Waiting on Dr. Lee' })).toContainText('#3561')
    for (const label of ['Ready 3', 'Sent 1', 'Rejected 1', 'Accepted 8', 'Pending 71', 'Denied 9', 'Partial 5', 'Appealed 3', 'Paid · Oct 124']) {
      await expect(strip.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(strip.getByRole('link', { name: 'Paid · Oct 124' })).toContainText('$64,746')
    await expect(page.getByTestId('badge-payments')).toHaveText('7')
    await expect(page.getByTestId('badge-eligibility')).toHaveText('3')
    await expect(page.getByTestId('badge-activity')).toHaveText('41')
    // #4744's situation had no name, so it shows no track record, not the records-request rule's 91 of 97.
    await page
      .getByRole('list', { name: 'Inbox items' })
      .getByRole('button', { name: /P\. Hale #4744/ })
      .click()
    await expect(page.getByTestId('track-record')).toContainText('No track record. TorchRCM couldn')
    await expect(page.getByTestId('track-record')).not.toContainText('%')
    // Castillo's situation has a name: its own record (Guardian CO-16 · M127), not the rule's 91 of 97.
    await page
      .getByRole('list', { name: 'Inbox items' })
      .getByRole('button', { name: /A\. Castillo #4797/ })
      .click()
    await expect(page.getByTestId('track-record')).toContainText('6 of 7 paid within 30 days')
    await expect(page.getByTestId('track-record')).not.toContainText('91')
  })
}
