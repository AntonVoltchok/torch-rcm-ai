/**
 * Steps 1–3: the Inbox on a fresh demo, the Delta group, ⇧A approves 3.
 * Owner: d1-inbox. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'

/** Inherits: a fresh demo on /inbox as Dana. */
export async function step1(page: Page) {
  const badge = page.getByTestId('badge-inbox')
  const strip = page.getByRole('region', { name: 'Claim pipeline' })
  await test.step('1 · Dana opens TorchRCM: Inbox 12, the strip, 5 agents · 1 running', async () => {
    await expect(badge).toHaveText('12')
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
    for (const label of ['Sent 5', 'Rejected 2', 'Accepted 24', 'Pending 57', 'Denied 5', 'Partial 5', 'Appealed 3', 'Paid · Oct 118']) {
      await expect(strip.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(strip.getByRole('link', { name: 'Paid · Oct 118' })).toContainText('$61,300')
    await expect(page.getByTestId('agents-indicator')).toContainText('5 agents · 1 running')
  })
}

/** Inherits: step 1. */
export async function step2(page: Page) {
  await test.step('2 · open the Delta group, select #4821: 92% basis, five evidence cards, owned root cause', async () => {
    const group = page.locator('[data-group-key]').filter({ hasText: 'missing PA x-ray (3)' })
    await expect(group).toContainText('$3,730')
    await group.getByRole('button', { name: /missing PA x-ray \(3\)/ }).click()
    await page.locator('[data-item-id="itm_4821"]').click() // the group opens on its top-priority member, #4840
    await expect(page).toHaveURL(/item=itm_4821/)
    const detail = page.getByRole('article', { name: /#4821/ })
    // D1: the pane decides for the open batch (its title is the heading); #4821 is the highlighted relay row, and the
    // track record leads with the server's percent and basis (was "#4821 · K. Owens" and "Why 92%:").
    await expect(detail.getByRole('heading', { level: 1 })).toHaveText('Delta Dental · missing PA x-ray (3)')
    await expect(detail.getByRole('link', { name: /K\. Owens #4821/ })).toBeVisible()
    await expect(detail.getByTestId('track-record')).toContainText('92%')
    await expect(detail.getByTestId('track-record')).toContainText('23 of 25')
    await expect(detail.locator('[data-evidence-kind]')).toHaveCount(5)
    await expect(detail.locator('[data-evidence-kind="portal_screenshot"]')).toBeVisible()
    await expect(detail.locator('[data-evidence-kind="pms_record"]')).toContainText('PA x-ray, tooth #19')
    await expect(detail.locator('[data-evidence-kind="era_line"]')).toContainText('CO-16')
    await expect(detail.locator('[data-evidence-kind="ivr_transcript"]')).toContainText('IVR-1027-1602')
    await expect(detail.locator('[data-evidence-kind="rep_call"]')).toContainText('DD-1027-88412')
    await expect(detail.getByTestId('audit-note')).toContainText('root cause: ours')
  })
}

/** Inherits: #4821 selected in the open Delta group. */
export async function step3(page: Page) {
  const badge = page.getByTestId('badge-inbox')
  const strip = page.getByRole('region', { name: 'Claim pipeline' })
  await test.step('3 · ⇧A approves 3: items leave, steps stream, NEA# appears, audit line; badge 9; Denied stays 5', async () => {
    await page.locator('body').press('Shift+A')
    await expect(page.locator('[data-group-key]')).toHaveCount(0)
    const panel = page.getByRole('region', { name: 'Agent progress' })
    await expect(panel).toBeVisible()
    const owens = panel.locator('section[data-run]').first()
    for (const step of ['act:fetch_image', 'act:nea_upload', 'act:write_remarks', 'act:queue_for_file']) {
      await expect(owens.locator(`[data-step="${step}"]`)).toHaveAttribute('data-status', 'ok', { timeout: 45_000 }) // the group runs one at a time
    }
    await expect(owens.getByText(/NEA# \d+/).first()).toBeVisible()
    await expect(owens.getByTestId('audit-line')).toContainText('until the 11:15 file leaves')
    await expect(panel.getByText(/you can leave/)).toBeVisible()
    await expect(badge).toHaveText('9')
    await expect(strip.getByRole('link', { name: 'Denied 5', exact: true })).toBeVisible()
  })
}
