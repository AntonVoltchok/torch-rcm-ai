/**
 * The D1 shell at the minimum supported width. Owner: d1-shell. Standalone (starts from freshDemo).
 *  - every screen fits 1280px: no horizontal scroll on the page or the screen's panel
 *  - the Inbox draws the whose-move cards + pipeline card; other screens draw the one-line pipeline
 *  - the pipeline keeps its "Claim pipeline" landmark and "Label N" link names on both forms
 *  - the skip link lands on the main landmark
 */
import { expect, test } from '@playwright/test'
import { freshDemo, nav, real } from './demo/shared'

const ROUTES = ['/inbox', '/ledger', '/claims', '/denials', '/payments', '/patients', '/eligibility', '/activity', '/settings/agents']

test.use({ viewport: { width: 1280, height: 800 } })

test('every screen fits 1280px and keeps the shell landmarks', async ({ page }) => {
  test.skip(real, 'layout only; the real target runs @demo')
  await freshDemo(page)
  for (const path of ROUTES) {
    await page.goto(path)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Claim pipeline' }).getByRole('link', { name: /^Denied \d+$/ })).toBeVisible()
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main')
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main ? main.scrollWidth - main.clientWidth : 0 }
    })
    expect(overflow, path).toEqual({ page: 0, main: 0 })
  }
})

test('the Inbox has the whose-move header; other screens have the one-line pipeline', async ({ page }) => {
  test.skip(real, 'layout only; the real target runs @demo')
  await freshDemo(page)
  const cards = page.locator('[data-move]')
  await expect(cards).toHaveCount(3)
  await expect(page.locator('[data-move="practice"]')).toContainText(await page.getByTestId('badge-inbox').innerText())
  await nav(page, /Claims/).click()
  await expect(cards).toHaveCount(0)
  const strip = page.getByRole('region', { name: 'Claim pipeline' })
  await strip.getByRole('link', { name: /^Denied \d+$/ }).click()
  await expect(page).toHaveURL(/status=denied/)
  await expect(strip.getByRole('link', { name: /^Denied \d+$/ })).toHaveAttribute('aria-current', 'true')
})

test('skip link moves focus to the screen', async ({ page }) => {
  test.skip(real, 'layout only; the real target runs @demo')
  await freshDemo(page)
  const skip = page.getByRole('link', { name: 'Skip to content' })
  await skip.focus()
  await expect(skip).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('main#main')).toBeFocused()
})
