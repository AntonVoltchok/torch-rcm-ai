/**
 * The onboarding tours (ADR-0009). Owner: onboarding-tours. Standalone (starts from freshDemo, then lets the tours open
 * on their own again).
 *  - @demo: the main tour end to end, both Try-its included: approve the Delta group (the run streams), then skip to
 *    the next morning as Dr. Morgan and back to Dana. Runs on MSW and, with E2E_TARGET=real, on the real API.
 *  - a screen tour opens on the first visit only; the sidebar menu checks it off; the header "?" restarts it.
 *  - the welcome opens on every load: a refresh or a new tab starts it again (owner's decision, D20).
 *  - Esc gives the app back from any step; the app's own shortcuts are quiet while the tour is up.
 */
import { expect, test, type Page } from '@playwright/test'
import { freshDemo, nav, real } from './demo/shared'

async function freshWithTours(page: Page) {
  await freshDemo(page)
  await page.evaluate(() => localStorage.removeItem('torchrcm.tour.autoopen'))
  await page.goto('/inbox')
}

const card = (page: Page) => page.getByTestId('tour-card')
const heading = (page: Page, name: string) => card(page).getByRole('heading', { name })
const next = (page: Page) => card(page).getByRole('button', { name: 'Next', exact: true })

test('the main tour follows #4821 through the loop, Try-its included @demo', async ({ page }) => {
  test.setTimeout(180_000)
  await freshWithTours(page)
  const welcome = page.getByTestId('tour-modal')
  await expect(welcome.getByRole('heading', { name: 'Welcome to TorchRCM' })).toBeVisible()
  await welcome.getByRole('button', { name: 'Start the tour' }).click()

  for (const title of ['Where the data comes from', 'The pipeline: nine statuses, one source', 'Whose move it is, decided by the server', 'How #4821 got here', 'What a model would see', 'Code decides whether it runs']) {
    await expect(heading(page, title)).toBeVisible()
    await expect(page.getByTestId('tour-hole')).toBeVisible()
    await expect(card(page).getByTestId('tour-missing')).toHaveCount(0)
    // Every number in the copy has resolved from the server.
    await expect(card(page).locator('[data-server-number]', { hasText: /^…$/ })).toHaveCount(0)
    await next(page).click()
  }
  await expect(page).toHaveURL(/\/inbox\?item=itm_4821/)

  // Dana decides: Try it presses the real approve button; the run pane opens and the tour moves on to it.
  await expect(heading(page, 'Dana decides')).toBeVisible()
  await card(page).getByTestId('tour-try').click()
  await expect(heading(page, 'The approval run')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('run-pane')).toBeVisible()
  await expect(card(page).getByTestId('tour-copy')).toContainText(/your Inbox \d+ → \d+/)
  await expect(card(page).getByTestId('tour-code')).toContainText("['run', 'run_")

  // The loop closes: as Dr. Morgan, Skip to the next morning, then back to Dana.
  await next(page).click()
  await expect(heading(page, 'The loop closes overnight')).toBeVisible()
  await card(page).getByTestId('tour-try').click()
  await expect(card(page).getByTestId('tour-try')).toHaveText('Next morning · signed in as Dana again', { timeout: 90_000 })
  await expect(page.getByTestId('clock-control')).toContainText('Clock control: Dr. Morgan')
  await expect(page.getByLabel('Switch user')).toHaveValue('usr_dana')
  await expect(page.getByTestId('clock-control')).toContainText(/Thu/)

  await next(page).click()
  const finish = page.getByTestId('tour-modal')
  await expect(finish.getByRole('heading', { name: 'That is the loop' })).toBeVisible()
  await expect(finish.getByRole('listitem').filter({ hasText: 'Inbox' }).first()).toBeVisible()
  await finish.getByRole('button', { name: 'Finish' }).click()
  await expect(page.getByTestId('tour-modal')).toHaveCount(0)
  await expect(page.getByTestId('tour-card')).toHaveCount(0)
})

test('the welcome opens on every load: after Skip, a refresh and a new tab both start it again', async ({ page, context }) => {
  test.skip(real, 'UI only; the real target runs @demo')
  await freshWithTours(page)
  const welcome = (p: Page) => p.getByTestId('tour-modal').getByRole('heading', { name: 'Welcome to TorchRCM' })
  await expect(welcome(page)).toBeVisible()
  await page.getByTestId('tour-modal').getByRole('button', { name: 'Skip, use the app' }).click()
  await expect(page.getByTestId('tour-modal')).toHaveCount(0)

  await page.reload()
  await expect(welcome(page)).toBeVisible()
  await page.keyboard.press('Escape')

  const tab = await context.newPage()
  await tab.goto('/claims')
  await expect(welcome(tab)).toBeVisible()
  await tab.close()
})

test('a screen tour opens on the first visit only, and the sidebar and header restart it', async ({ page }) => {
  test.skip(real, 'UI only; the real target runs @demo')
  await freshWithTours(page)
  await page.getByTestId('tour-modal').getByRole('button', { name: 'Skip, use the app' }).click()

  await nav(page, /Denials/).click()
  await expect(heading(page, 'Denied claims, and whose move')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(heading(page, 'Grouped by what happens next')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)

  // Second visit: no tour. The menu shows Denials as seen.
  await nav(page, /Claims/).click()
  await expect(heading(page, 'Views and counts')).toBeVisible()
  await card(page).getByRole('button', { name: 'Exit tour' }).first().click()
  await nav(page, /Denials/).click()
  await expect(page.getByTestId('denials-summary')).toBeVisible()
  await expect(card(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'All tours' }).click()
  const menu = page.getByRole('menu', { name: 'Tours' })
  await expect(menu.getByRole('menuitem', { name: /Denials \(seen\)/ })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Ledger|Today’s claims$/ })).not.toContainText('seen')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  // The header "?" restarts this screen's tour.
  await page.getByTestId('tour-header-button').click()
  await expect(heading(page, 'Denied claims, and whose move')).toBeVisible()
  await expect(page.locator('[inert]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[inert]')).toHaveCount(0)
})

test('a step whose state the demo has left gets it back before it is drawn', async ({ page }) => {
  test.skip(real, 'UI only; the real target runs @demo')
  await freshWithTours(page)
  await page.getByTestId('tour-modal').getByRole('button', { name: 'Skip, use the app' }).click()
  // Take #4821's group off the Inbox the ordinary way, then open the main tour at "How #4821 got here".
  await page.goto('/inbox?item=itm_4821')
  // A load opens the main tour again (dismissal lasts one load).
  await page.getByTestId('tour-modal').getByRole('button', { name: 'Skip, use the app' }).click()
  await page.getByTestId('decision').getByRole('button', { name: /resubmit/i }).first().click()
  await expect(page.getByTestId('run-pane')).toBeVisible()
  await page.getByRole('button', { name: 'All tours' }).click()
  await page.getByRole('menuitem', { name: /Main tour/ }).click()
  await page.getByTestId('tour-modal').getByRole('button', { name: 'Start the tour' }).click()
  // #4821 is approved, so the first step that follows it resets the practice to the seed first, and says why.
  await expect(page.getByTestId('tour-preparing')).toContainText('K. Owens #4821 is approved')
  await expect(page.getByTestId('tour-preparing')).toHaveCount(0, { timeout: 30_000 })
  for (let i = 0; i < 3; i++) await next(page).click()
  await expect(heading(page, 'How #4821 got here')).toBeVisible()
  await expect(page.getByTestId('tour-hole')).toHaveCount(1)
  await expect(card(page).getByTestId('tour-missing')).toHaveCount(0)
})
