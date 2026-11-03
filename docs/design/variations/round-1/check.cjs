// node check.cjs <variant> <outDir>: screenshots a variation in every state and lists text under 12px.
const { chromium } = require('@playwright/test');
const path = require('path');
(async () => {
  const [v, dir] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1090 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto('file://' + path.join(__dirname, 'dist', `only-${v}.html`));
  await p.waitForTimeout(500);
  const open = (screen) => p.evaluate(([v, s]) => { const h = window.TorchHarness; h.state.view = v; h.state.screen = s; h.renderAll() }, [v, screen]);
  const act = (a) => p.evaluate((a) => window.TorchHarness.state.apps[0].app.perform(a), a);
  const shot = async (n) => {
    const f = p.locator('.frame').first();
    await f.screenshot({ path: `${dir}/${n}.png` });
    const small = await p.evaluate(() => {
      const r = window.TorchHarness.state.apps[0].mountEl; const out = {}; let over = 0;
      r.querySelectorAll('*').forEach((e) => {
        if (![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return;
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 12) { const t = e.textContent.trim().slice(0, 30); out[t] = fs }
        if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth > 0) over++;
      });
      return { under12: Object.entries(out).slice(0, 6), clipped: over };
    });
    console.log(n, JSON.stringify(small));
  };
  await open('inbox'); await p.waitForTimeout(250); await shot('1-inbox');
  await act('select:itm_4840'); await shot('2-group');
  await act('select:itm_4733'); await shot('3-draft');
  await act('select:itm_4611'); await shot('4-blocked');
  await act('select:itm_4840');
  await act('approve-group:delta_ny:denied:CO-16:N29:pa_missing'); await p.waitForTimeout(1100); await shot('5-running');
  await p.waitForTimeout(2600); await shot('6-done');
  await act('next'); await act('select:itm_4851'); await act('approve:itm_4851'); await p.waitForTimeout(1200); await shot('7-failed');
  await open('claim'); await p.waitForTimeout(200); await shot('8-claim');
  await open('denials'); await p.waitForTimeout(200); await shot('9-denials');
  console.log('errors', errs.slice(0, 6));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
