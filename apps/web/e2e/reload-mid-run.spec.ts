/** A reload mid-run resubscribes to the run's events and finishes. Owner: d1-inbox. Standalone: starts from a fresh demo. Tagged @demo. */
import { expect, test } from '@playwright/test'
import { freshDemo } from './demo/shared'

test('reload mid-run resubscribes and finishes @demo', async ({ page }) => {
  await freshDemo(page)
  await page.goto('/inbox?item=itm_4705')
  await page.getByRole('button', { name: /Send prompt-pay request/ }).click() // D1: the button is the action (was "Approve & run")
  const panel = page.getByRole('region', { name: 'Agent progress' })
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/launch=/)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Agent progress' }).getByTestId('audit-line')).toBeVisible({ timeout: 20_000 })
})
