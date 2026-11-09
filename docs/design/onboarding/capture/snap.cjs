// Usage: node snap.cjs <label> <user> <path> [waitMs]  — screenshot + #root innerHTML of the real app at 1440x900
const { chromium } = require(require('path').resolve(__dirname, '../../../../apps/web/node_modules/@playwright/test'));
const OUT = process.env.OUT;
const BASE = process.env.WEB || 'http://localhost:5180';
async function snap(page, label) {
  await page.screenshot({ path: `${OUT}/png/${label}.png` });
  await page.evaluate(() => { document.querySelectorAll('select').forEach((s) => [...s.options].forEach((o) => o.toggleAttribute('selected', o.selected))); document.querySelectorAll('input').forEach((i) => (i.type === 'checkbox' || i.type === 'radio' ? i.toggleAttribute('checked', i.checked) : i.setAttribute('value', i.value))); }); // controlled state is a property, not markup
    const html = await page.evaluate(() => document.getElementById('root').innerHTML);
  require('fs').writeFileSync(`${OUT}/dom/${label}.html`, html);
}
(async () => {
  const jobs = JSON.parse(process.argv[2]);
  const browser = await chromium.launch();
  for (const j of jobs) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((u) => localStorage.setItem('torch.session', JSON.stringify({ userId: u, locationId: 'all' })), j.user);
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') console.log(j.label, 'console error:', m.text()); });
    await page.goto(BASE + j.path, { waitUntil: 'load' });
    await page.waitForTimeout(j.wait || 2500);
    await snap(page, j.label);
    if (j.css) {
      const css = await page.evaluate(() => [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch (e) { return ''; } }).join('\n'));
      require('fs').writeFileSync(`${OUT}/app.css`, css);
    }
    console.log('ok', j.label);
    await ctx.close();
  }
  await browser.close();
})();
