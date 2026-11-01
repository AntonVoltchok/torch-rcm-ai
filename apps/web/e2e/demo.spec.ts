/**
 * Demo script steps 1–5 (+3b) from docs/spec/06-demo-script.md, as one story: each step starts where the
 * previous one left the practice. Tagged @demo; runs against MSW by default and against the real API
 * with E2E_TARGET=real (after `make seed`).
 */
import { expect, test, type Page } from '@playwright/test'

const real = process.env.E2E_TARGET === 'real'

test.describe.configure({ mode: 'serial' })

async function freshDemo(page: Page) {
  if (real) {
    await page.request.post('http://localhost:8000/api/v1/clock/reset', { headers: { 'X-Torch-User': 'usr_morgan' } })
  }
  await page.goto('/inbox')
  await page.evaluate(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
  await page.goto('/inbox')
}

test('demo steps 1–5 @demo', async ({ page }) => {
  await freshDemo(page)
  const badge = page.getByTestId('badge-inbox')
  const strip = page.getByRole('region', { name: 'Claim pipeline' })

  await test.step('1 · Dana opens Torch: Inbox 12, the strip, 5 agents · 1 running', async () => {
    await expect(badge).toHaveText('12')
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
    for (const label of ['Sent 5', 'Rejected 2', 'Accepted 24', 'Pending 57', 'Denied 5', 'Partial 5', 'Appealed 3', 'Paid · Oct 118']) {
      await expect(strip.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(strip.getByRole('link', { name: 'Paid · Oct 118' })).toContainText('$61,300')
    await expect(page.getByTestId('agents-indicator')).toContainText('5 agents · 1 running')
  })

  await test.step('2 · open the Delta group: #4821 with 92% basis, three evidence cards, owned root cause', async () => {
    const group = page.locator('[data-group-key]').filter({ hasText: 'missing PA x-ray (3)' })
    await expect(group).toContainText('$3,730')
    await group.getByRole('button', { name: /missing PA x-ray \(3\)/ }).click()
    await expect(page).toHaveURL(/item=inb_4821/)
    const detail = page.getByRole('article', { name: /#4821/ })
    await expect(detail.getByRole('heading', { name: '#4821 · K. Owens' })).toBeVisible()
    await expect(detail.getByText(/Why 92%:/)).toBeVisible()
    await expect(detail.getByText(/23 of 25/)).toBeVisible()
    await expect(detail.locator('[data-evidence-kind]')).toHaveCount(3)
    await expect(detail.locator('[data-evidence-kind="portal_screenshot"]')).toBeVisible()
    await expect(detail.locator('[data-evidence-kind="pms_record"]')).toContainText('PMS imaging')
    await expect(detail.locator('[data-evidence-kind="era_line"]')).toContainText('CO-16')
    await expect(detail.getByTestId('audit-note')).toContainText('root cause: ours')
  })

  await test.step('3 · ⇧A approves 3: items leave, steps stream, NEA# appears, audit line; badge 9; Denied stays 5', async () => {
    await page.locator('body').press('Shift+A')
    await expect(page.locator('[data-group-key]')).toHaveCount(0)
    const panel = page.getByRole('region', { name: 'Agent progress' })
    await expect(panel).toBeVisible()
    const owens = panel.locator('section[data-run]').first()
    for (const step of ['fetch_pa_from_pms_imaging', 'upload_to_nea', 'write_nea_to_remarks', 'queue_for_delta_file']) {
      await expect(owens.locator(`[data-step="${step}"]`)).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    }
    await expect(owens.getByText(/NEA# \d+/).first()).toBeVisible()
    await expect(owens.getByTestId('audit-line')).toContainText('11:15 Delta file')
    await expect(panel.getByText(/you can leave/)).toBeVisible()
    await expect(badge).toHaveText('9')
    await expect(strip.getByRole('link', { name: 'Denied 5', exact: true })).toBeVisible()
  })

  await test.step('3b · live triage on #4744: reads, label, verdict; one new item; badge 10', async () => {
    const search = page.getByLabel('Search claims and patients')
    await search.fill('4744')
    await search.press('Enter')
    await expect(page).toHaveURL(/\/claims\?q=4744/)
    await page.getByRole('row').filter({ hasText: '#4744' }).click()
    await expect(page.getByRole('heading', { name: 'Claim #4744' })).toBeVisible()
    await page.getByRole('button', { name: /Ask Follow-up to look/ }).click()
    const panel = page.getByRole('region', { name: 'Agent progress' })
    await expect(panel.getByText('↳ read portal correspondence 10/22')).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText(/payer asks for missing-tooth history/)).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText('Policy: ask Dana → Inbox')).toBeVisible()
    await expect(panel.getByText(/recorded agent plan|live agent/)).toBeVisible()
    await expect(panel.locator('[data-step="report"]')).toHaveAttribute('data-status', 'ok', { timeout: 20_000 })
    await expect(badge).toHaveText('10')
    await expect(page.getByRole('region', { name: 'Open inbox items' })).toContainText('records request')
  })

  await test.step('4 · back to the Inbox, open #4821 from the completed run: whole story, nothing open, resubmit queued', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Inbox/ }).click()
    await page.getByRole('region', { name: 'Runs you started' }).getByRole('button', { name: /Approve 3/ }).click()
    await page.getByRole('link', { name: 'Open claim #4821 →' }).click()
    await expect(page.getByRole('heading', { name: 'Claim #4821' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: '‹ Inbox' })).toBeVisible()
    await expect(page.getByTestId('no-open-items')).toContainText('resubmit queued · leaves 11:15')
    const timeline = page.getByRole('region', { name: 'Timeline' })
    await expect(timeline).toContainText('Built claim at checkout with BWX')
    await expect(timeline).toContainText('root cause: ours')
    await expect(timeline.locator('li[data-lane]').last()).toContainText('Resubmitted with PA')
  })

  await test.step('5 · Denied 5 tile → /claims?status=denied; refresh keeps it; j j enter opens Webb; back', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Inbox/ }).click()
    await page.getByRole('region', { name: 'Claim pipeline' }).getByRole('link', { name: 'Denied 5', exact: true }).click()
    await expect(page).toHaveURL(/\/claims\?status=denied$/)
    const table = page.getByRole('table', { name: 'Claims' })
    await expect(table.locator('[role="row"][data-row-id]')).toHaveCount(5)
    await page.reload()
    await expect(page).toHaveURL(/\/claims\?status=denied$/)
    await expect(table.locator('[role="row"][data-row-id]')).toHaveCount(5)
    await page.locator('body').press('j')
    await page.locator('body').press('j')
    await expect(page).toHaveURL(/row=clm_4733/)
    await page.locator('body').press('Enter')
    await expect(page).toHaveURL(/\/claims\/clm_4733/)
    await expect(page.getByRole('heading', { name: 'Claim #4733' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/claims\?status=denied/)
  })
})

test('reload mid-run resubscribes and finishes @demo', async ({ page }) => {
  await freshDemo(page)
  await page.goto('/inbox?item=inb_4705')
  await page.getByRole('button', { name: /Approve & run/ }).click()
  const panel = page.getByRole('region', { name: 'Agent progress' })
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/launch=/)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Agent progress' }).getByTestId('audit-line')).toBeVisible({ timeout: 20_000 })
})
