/**
 * Demo script steps 1–10 (+3b) from docs/spec/06-demo-script.md, as one story: each step starts where the
 * previous one left the practice. Tagged @demo; runs against MSW by default and against the real API
 * with E2E_TARGET=real (after `make seed`). Steps 6–10 select by labels and the ids the mock and the API seed
 * share (rule ids, claim numbers), never by mock-only ids.
 */
import { expect, test, type Page } from '@playwright/test'

const real = process.env.E2E_TARGET === 'real'

test.describe.configure({ mode: 'serial' })

async function switchUser(page: Page, id: 'usr_dana' | 'usr_morgan') {
  await page.getByLabel('Switch user').selectOption(id)
}

const nav = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })

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

test('demo steps 1–10 @demo', async ({ page }) => {
  test.setTimeout(240_000)
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
    await expect(page).toHaveURL(/item=itm_4821/)
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
    await expect(timeline).toContainText('built claim #4821 at checkout')
    await expect(timeline).toContainText('BWX NEA# 47720913')
    await expect(timeline).toContainText('root cause: ours')
    await expect(timeline.locator('li[data-lane]').last()).toContainText('resubmit with the NEA#')
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

  await test.step('8 · ⏭ Skip to Thu 7:10 AM: async progress, then Inbox 17 (Dana), the strip, the nav badges', async () => {
    const clock = page.getByTestId('clock-control')
    await clock.getByRole('button', { name: /Skip to Thu 7:10 AM/ }).click()
    await expect(clock.getByRole('button', { name: /Skip to/ })).toBeDisabled()
    await expect(clock.getByTestId('advance-progress')).toBeVisible()
    await expect(clock.getByTestId('advance-progress')).toBeHidden({ timeout: 60_000 })
    await expect(clock).toContainText('Thu Oct 29 · 7:10 AM')
    await switchUser(page, 'usr_dana')
    await nav(page, /Inbox/).click()
    await expect(badge).toHaveText('17') // 10 after step 3b + 4 overnight denials + 3 status-check proposals
    for (const label of ['Ready 3', 'Sent 1', 'Rejected 1', 'Accepted 8', 'Pending 71', 'Denied 9', 'Partial 5', 'Appealed 3', 'Paid · Oct 124']) {
      await expect(strip.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(strip.getByRole('link', { name: 'Paid · Oct 124' })).toContainText('$64,746')
    await expect(page.getByTestId('badge-payments')).toHaveText('7')
    await expect(page.getByTestId('badge-eligibility')).toHaveText('3')
    await expect(page.getByTestId('badge-activity')).toHaveText('41')
  })

  await test.step('9 · Activity → Follow-up rows with evidence; Observe-mode preview styles them “would have run”', async () => {
    await nav(page, /Activity/).click()
    await page.getByLabel('Agent').selectOption('followup')
    await expect(page).toHaveURL(/agent=followup/)
    const log = page.getByRole('table', { name: 'Activity' })
    await expect(log.locator('tr[data-run-id]').filter({ hasText: 'IVR transcript' }).first()).toBeVisible()
    await expect(log.locator('tr[data-run-id]').filter({ hasText: 'DD-1027-88412' }).first()).toContainText('rep call')
    await page.getByLabel('Observe mode preview').check()
    await expect(page).toHaveURL(/observe=true/)
    await expect(log.locator('tr[data-style="observe_preview"]').first()).toContainText('would have run')
  })

  await test.step('10 · Cash as Dr. Morgan (days in A/R 27 with its formula, write-offs, estimate); Denials by next action, Ito’s formal appeal', async () => {
    await switchUser(page, 'usr_morgan')
    await nav(page, /Cash/).click()
    const days = page.locator('[data-kpi="days_in_ar"]')
    await expect(days).toContainText('27')
    await expect(days).toContainText('= (insurance A/R + patient A/R) ÷ average daily net production (90 d)')
    await expect(page.getByRole('region', { name: 'Write-offs by type' })).toBeVisible()
    await expect(page.getByTestId('agent-impact')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Agent impact' })).toContainText('estimate')

    await nav(page, /Denials/).click()
    const list = page.getByRole('table', { name: 'Denials worklist' })
    const formal = list.getByRole('rowgroup', { name: /Formal appeal/ })
    const ito = formal.locator('tr[data-claim-number="4796"]')
    await expect(ito).toContainText('Formal appeal')
    await expect(ito).toContainText('Dr. Lee signs')
    await expect(ito).toContainText('patient authorization required (ERISA)')
    await expect(ito).toContainText('patient cannot be billed')
    await expect(page.getByRole('complementary', { name: 'Payer × reason' })).toBeVisible()
    await ito.getByRole('link', { name: 'Appeal workbench →' }).click()
    await expect(page).toHaveURL(/\/denials\/clm_4796/)
    await expect(page.getByText('Designed, not built in this demo.')).toBeVisible()
  })
})

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

test('reload mid-run resubscribes and finishes @demo', async ({ page }) => {
  await freshDemo(page)
  await page.goto('/inbox?item=itm_4705')
  await page.getByRole('button', { name: /Approve & run/ }).click()
  const panel = page.getByRole('region', { name: 'Agent progress' })
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/launch=/)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Agent progress' }).getByTestId('audit-line')).toBeVisible({ timeout: 20_000 })
})
