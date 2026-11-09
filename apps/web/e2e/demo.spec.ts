/**
 * Demo script steps 1–10 (+3b) from docs/spec/06-demo-script.md, as one story: each step starts where the
 * previous one left the practice. Tagged @demo; runs against MSW by default and against the real API
 * with E2E_TARGET=real (after `make seed`). Steps 6–10 select by labels and the ids the mock and the API seed
 * share (rule ids, claim numbers), never by mock-only ids.
 *
 * One test on purpose: the MSW db lives in the tab's sessionStorage, so state cannot cross tests or files. Each step
 * lives in its own file under e2e/demo/ with one owner (e2e/demo/README.md); this file only fixes the order.
 */
import { test } from '@playwright/test'
import { step1, step2, step3 } from './demo/01-inbox'
import { step3b } from './demo/02-claim-triage'
import { step4 } from './demo/03-run-to-claim'
import { step5 } from './demo/04-claims-list'
import { step6, step7 } from './demo/05-settings'
import { step8 } from './demo/06-overnight'
import { step9 } from './demo/07-activity'
import { step10a } from './demo/08-cash'
import { step10b } from './demo/09-denials'
import { freshDemo } from './demo/shared'

test.describe.configure({ mode: 'serial' })

test('demo steps 1–10 @demo', async ({ page }) => {
  test.setTimeout(240_000)
  await freshDemo(page)
  await step1(page)
  await step2(page)
  await step3(page)
  await step3b(page)
  await step4(page)
  await step5(page)
  const morganInbox = await step6(page)
  await step7(page, morganInbox)
  await step8(page)
  await step9(page)
  await step10a(page)
  await step10b(page)
})
