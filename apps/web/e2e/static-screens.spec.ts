/** Static screens read seed data. Owner: d1-rest. Standalone: starts from a fresh demo. Tagged @demo. */
import { expect, test } from '@playwright/test'
import { freshDemo, nav } from './demo/shared'

test('static screens read seed data: Today’s claims, Eligibility (J. Chen) @demo', async ({ page }) => {
  await freshDemo(page)
  await nav(page, /Today’s claims/).click()
  await expect(page.getByTestId('ledger-summary')).toContainText('Sent today 5 · $1,320')
  await expect(page.getByTestId('ledger-leaving').first()).toContainText('Leaving in the 10:45 AM file')
  await expect(page.getByTestId('ledger-leaving').first()).toContainText('#4859')
  const held = page.getByRole('table', { name: 'Held' })
  await expect(held.locator('tr[data-claim-number]')).toHaveCount(3)
  await expect(page.getByTestId('ledger-not-billable')).toContainText('J. Ortega')

  await nav(page, /Eligibility/).click()
  await page.getByRole('table', { name: 'Appointments' }).getByRole('row').filter({ hasText: 'J. Chen' }).click()
  await expect(page).toHaveURL(/appt=/)
  const card = page.getByRole('complementary', { name: /Benefits · J. Chen/ })
  await expect(card.getByTestId('max-left')).toHaveText('$180')
  await expect(card.getByTestId('insurance-est')).toHaveText('$180')
  await expect(card.getByTestId('patient-est')).toHaveText('$470')
  await page.reload()
  await expect(page.getByRole('complementary', { name: /Benefits · J. Chen/ })).toBeVisible()
})
