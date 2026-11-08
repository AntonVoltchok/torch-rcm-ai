/**
 * Steps 6–7: Settings › Agents as Dr. Morgan, then a tier-2 flip by each user.
 * Owner: d1-rest. Part of the demo story in e2e/demo.spec.ts (one test, steps in order; see e2e/demo/README.md). Do not run alone:
 * each step starts where the previous one left the practice.
 */
import { expect, test, type Page } from '@playwright/test'
import { nav, switchUser } from './shared'

/** Inherits: Dana on the claims list after step 5. Returns Dr. Morgan's Inbox badge before step 7 bumps it. */
export async function step6(page: Page): Promise<number> {
  const badge = page.getByTestId('badge-inbox')
  let morganInbox = 0

  await test.step('6 · Settings › Agents as Dr. Morgan: tiers, live preview 41 → 44 of 54, accept the Delta proposal; the ours sibling is guarded', async () => {
    await switchUser(page, 'usr_morgan')
    await expect(badge).not.toHaveText('')
    morganInbox = Number(await badge.textContent())
    await nav(page, /Settings/).click()
    await expect(page).toHaveURL(/\/settings\/agents/)
    const table = page.getByRole('table', { name: 'Agent rules' })
    for (const tier of ['Tier 1 · Talks to payers', 'Tier 2 · Touches the ledger or patients', 'Tier 3 · Commits the practice']) {
      await expect(table.getByRole('rowgroup', { name: tier })).toBeVisible()
    }
    await expect(table.locator('tbody[data-tier="3"] [data-testid="human-only"]')).toHaveCount(3)
    await expect(table.locator('tbody[data-tier="3"] [role="radiogroup"]')).toHaveCount(0)

    const delta = table.locator('tr[data-rule-id="rule_t1_delta_pa"]')
    await delta.getByRole('radio', { name: 'Runs without review' }).hover()
    const preview = page.getByRole('region', { name: 'Live preview' })
    await expect(preview.getByTestId('preview-numbers')).toHaveText('41 → 44')
    await expect(preview).toContainText('of this week’s 54 would have run')
    await expect(preview.getByTestId('preview-held')).toContainText('root cause: ours')
    await expect(preview.getByTestId('preview-held')).toContainText('net 41')

    await page.getByRole('tab', { name: /Proposals/ }).click()
    await expect(page).toHaveURL(/tab=proposals/)
    const ours = page.locator('[data-proposal-id="prop_delta_pa_ours"]')
    await expect(ours.getByRole('button', { name: 'Accept' })).toBeDisabled()
    await expect(ours.getByTestId('proposal-blocked')).toContainText('root cause: ours')
    const proposal = page.locator('[data-proposal-id="prop_delta_pa"]')
    await expect(proposal.getByTestId('proposal-evidence')).toContainText('23 of 25')
    await proposal.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByText(/New rule: /)).toBeVisible()

    await page.getByRole('tab', { name: /Rules/ }).click()
    const learned = table.locator('tr[data-rule-id^="rule_t1_delta_pa_learned"]')
    await expect(learned).toContainText('learned')
    await expect(learned).toContainText('signed by Dr. Morgan')
    await expect(learned).toContainText('paid ≤ 30 d')
  })
  return morganInbox
}

/** Inherits: Settings › Agents › Rules as Dr. Morgan, the Delta proposal accepted. */
export async function step7(page: Page, morganInbox: number) {
  const badge = page.getByTestId('badge-inbox')
  await test.step('7 · a tier-2 flip applies for Dr. Morgan and is logged; for Dana it is sent to Dr. Morgan, whose badge bumps', async () => {
    const table = page.getByRole('table', { name: 'Agent rules' })
    const era = table.locator('tr[data-rule-id="rule_t2_post_era"]')
    await era.getByRole('radio', { name: 'Ask Dana' }).click()
    await expect(era.getByRole('radio', { name: 'Ask Dana' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('tab', { name: /Changes/ }).click()
    const changes = page.getByRole('table', { name: 'Rule changes' })
    await expect(changes.getByRole('row').filter({ hasText: 'Post ERA line' }).first()).toContainText('Dr. Morgan')
    await expect(changes).toContainText('mode: Runs without review → Ask Dana')
    await expect(page.getByTestId('owner-digest')).toContainText('Mon digest to Dr. Morgan')

    await switchUser(page, 'usr_dana')
    await nav(page, /Settings/).click()
    await page.getByRole('tab', { name: /Rules/ }).click()
    const eraAsDana = page.getByRole('table', { name: 'Agent rules' }).locator('tr[data-rule-id="rule_t2_post_era"]')
    await expect(eraAsDana).toContainText('Needs Dr. Morgan')
    await eraAsDana.getByRole('radio', { name: 'Runs without review' }).click()
    await expect(page.getByText('Sent to Dr. Morgan for sign-off')).toBeVisible()
    await expect(eraAsDana.getByRole('radio', { name: 'Ask Dana' })).toHaveAttribute('aria-checked', 'true') // reverted

    await switchUser(page, 'usr_morgan')
    await expect(badge).toHaveText(String(morganInbox + 1))
  })
}
