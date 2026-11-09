// The demo script's mutations, driven through the real UI, capturing DOM + PNG + the mutation responses.
const { chromium } = require(require('path').resolve(__dirname, '../../../../apps/web/node_modules/@playwright/test'));
const fs = require('fs');
const OUT = process.env.OUT, RAW = process.env.RAW, BASE = process.env.WEB || 'http://localhost:5180';
let browser, page, ctx;
async function open(user, path) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((u) => localStorage.setItem('torch.session', JSON.stringify({ userId: u, locationId: 'all' })), user);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log(path, 'console error:', m.text()); });
  page.on('response', async (r) => {
    const req = r.request();
    if (req.method() !== 'GET' && r.url().includes('/api/v1/')) {
      let body = null; try { body = await r.json(); } catch (e) {}
      const name = 'mut_' + Date.now() + '_' + req.method() + '_' + r.url().split('/api/v1/')[1].replace(/[^\w:.-]+/g, '_').slice(0, 60);
      fs.writeFileSync(`${RAW}/${name}.json`, JSON.stringify({ request: `${req.method()} ${r.url().split('/api')[1]}`, user, headers: req.headers(), request_body: req.postDataJSON?.() ?? null, status: r.status(), body }, null, 1));
      console.log('captured', name, r.status());
    }
  });
  await page.goto(BASE + path, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { page, ctx };
}
async function snap(page, label) {
  await page.screenshot({ path: `${OUT}/png/${label}.png` });
  await page.evaluate(() => { document.querySelectorAll('select').forEach((s) => [...s.options].forEach((o) => o.toggleAttribute('selected', o.selected))); document.querySelectorAll('input').forEach((i) => (i.type === 'checkbox' || i.type === 'radio' ? i.toggleAttribute('checked', i.checked) : i.setAttribute('value', i.value))); }); // controlled state is a property, not markup
    fs.writeFileSync(`${OUT}/dom/${label}.html`, await page.evaluate(() => document.getElementById('root').innerHTML));
  console.log('snap', label);
}
(async () => {
  browser = await chromium.launch();
  const PHASE = process.env.PHASE || 'all';
  if (PHASE === 'all') {
  // 1 · Approve the Delta group (demo step 3)
  ({ page, ctx } = await open('usr_dana', '/inbox?item=itm_4821'));
  await page.getByRole('button', { name: /Send 3 x-rays and resubmit/ }).click();
  await page.waitForTimeout(250); await snap(page, 'run_delta_t0');
  await page.waitForTimeout(900); await snap(page, 'run_delta_t1');
  await page.waitForSelector('[data-testid=audit-line]', { timeout: 30000 }).catch(() => console.log('no audit line'));
  await page.waitForTimeout(1500); await snap(page, 'run_delta_done');
  await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/claims/clm_4821')); await snap(page, 'claim_4821_after'); await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/inbox')); await snap(page, 'inbox_after'); await ctx.close();
  }
  if (PHASE === 'all' || PHASE === 'triage') {
  // 3b · Live triage on #4744 (PHASE=triage runs it alone on a fresh seed, so the claim-detail tour reads 11 → 12)
  ({ page, ctx } = await open('usr_dana', '/claims/clm_4744'));
  await page.getByRole('button', { name: /Ask Follow-up to look/ }).click();
  await page.waitForTimeout(600); await snap(page, 'triage_4744_t0');
  await page.waitForTimeout(1500); await snap(page, 'triage_4744_t1');
  await page.waitForSelector('[data-testid=audit-line]', { timeout: 60000 }).catch(() => console.log('no audit line (triage)'));
  await page.waitForTimeout(1500); await snap(page, 'triage_4744_done');
  await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/inbox')); await snap(page, 'inbox_after_triage'); await ctx.close();
  }
  if (PHASE === 'triage') { await browser.close(); return; }
  // 6 · Settings: hover previews, accept a proposal (PHASE=settings runs only this, on a fresh seed)
  ({ page, ctx } = await open('usr_dana', '/settings/agents'));
  await page.getByRole('radiogroup', { name: /Status check/ }).getByRole('radio', { name: 'Runs without review' }).hover();
  await page.waitForTimeout(1200); await snap(page, 'settings_hover_status');
  await page.getByRole('radiogroup', { name: /Missing PA x-ray/ }).getByRole('radio', { name: 'Runs without review' }).hover();
  await page.waitForTimeout(1200); await snap(page, 'settings_hover_delta');
  await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/settings/agents?tab=proposals'));
  await snap(page, 'settings_proposals_before');
  const cards = page.locator('text=Delta · missing PA x-ray · resubmits under $2,000');
  const card = page.locator('article, li, section, div').filter({ has: cards }).filter({ has: page.getByRole('button', { name: 'Accept' }) }).last();
  await card.getByRole('button', { name: 'Accept' }).click();
  await page.waitForTimeout(1500); await snap(page, 'settings_proposals_after');
  await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/settings/agents')); await snap(page, 'settings_rules_after_accept'); await ctx.close();
  // 7 · Tier 2: Morgan applies, Dana gets 409
  ({ page, ctx } = await open('usr_morgan', '/settings/agents'));
  await page.getByRole('radiogroup', { name: /Post ERA line/ }).getByRole('radio', { name: /Ask/ }).click();
  await page.waitForTimeout(1500); await snap(page, 'settings_t2_morgan'); await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/settings/agents'));
  await page.getByRole('radiogroup', { name: /Post ERA line/ }).getByRole('radio', { name: 'Runs without review' }).click();
  await page.waitForTimeout(700); await snap(page, 'settings_t2_dana_409'); await ctx.close();
  ({ page, ctx } = await open('usr_dana', '/settings/agents?tab=changes')); await snap(page, 'settings_changes_after'); await ctx.close();
  if (PHASE === 'settings') { await browser.close(); return; }
  ({ page, ctx } = await open('usr_morgan', '/inbox')); await snap(page, 'inbox_morgan_before_adv');
  // 8 · Skip to Thursday 7:10 (owner)
  await page.getByRole('button', { name: /Skip to Thu 7:10 AM/ }).click();
  await page.waitForTimeout(1500); await snap(page, 'advance_t0');
  await page.waitForTimeout(5000); await snap(page, 'advance_t1');
  await page.waitForSelector('[data-testid=advance-progress]', { state: 'detached', timeout: 120000 }).catch(() => console.log('advance still running'));
  await page.waitForTimeout(3000); await snap(page, 'advance_done_morgan'); await ctx.close();
  for (const [label, user, path] of [['inbox_thu', 'usr_dana', '/inbox'], ['activity_thu', 'usr_dana', '/activity'], ['denials_thu', 'usr_dana', '/denials'], ['cash_thu', 'usr_morgan', '/cash'], ['inbox_lee_thu', 'usr_lee', '/inbox']]) {
    ({ page, ctx } = await open(user, path)); await snap(page, label); await ctx.close();
  }
  await browser.close();
})();
