/**
 * The run pane opens on the click, before the server answers (final D1 red team: no 1–2 s frame of the next item).
 * Real target only: the hold is a Playwright route on the approve POST, which MSW's service worker would answer
 * before Playwright sees it. Owner: rt-flash. Standalone: starts from a fresh demo. Tagged @demo.
 */
import { expect, test } from '@playwright/test'
import { freshDemo, real } from './demo/shared'

test('Approve shows the run pane, Starting…, before the approve response @demo', async ({ page }) => {
  test.skip(!real, 'needs the real API: the route hold cannot see requests MSW answers')
  await freshDemo(page)
  await page.goto('/inbox?item=itm_4705')
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  let answered = false
  await page.route(/\/inbox\/itm_4705:approve$/, async (route) => {
    await held
    await route.continue()
    answered = true
  })

  await page.getByRole('button', { name: /Send prompt-pay request/ }).click()
  const pane = page.getByRole('region', { name: 'Agent progress' })
  await expect(pane).toHaveAttribute('data-starting', 'true')
  await expect(pane.getByRole('heading', { level: 2 })).toHaveText('Starting…')
  await expect(page.getByRole('article')).toHaveCount(0) // no decision pane, the next item's included
  await expect(page).toHaveURL(/launch=starting/)
  expect(answered).toBe(false)

  release()
  await expect(pane.locator('[data-step]').first()).toBeVisible({ timeout: 10_000 })
  await expect(pane).not.toHaveAttribute('data-starting')
  await expect(page).toHaveURL(/launch=run_/)
  await expect(pane.getByTestId('audit-line')).toBeVisible({ timeout: 20_000 })
})
