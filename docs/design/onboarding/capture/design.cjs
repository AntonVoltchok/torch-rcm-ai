const { chromium } = require(require('path').resolve(__dirname, '../../../../apps/web/node_modules/@playwright/test'));
(async () => {
  const b = await chromium.launch();
  for (const p of ['payments', 'patients']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => localStorage.setItem('torch.session', JSON.stringify({ userId: 'usr_dana', locationId: 'all' })));
    const page = await ctx.newPage();
    await page.goto((process.env.WEB || 'http://localhost:5180') + '/' + p); await page.waitForTimeout(3500);
    const box = await page.locator('iframe').boundingBox(); console.log(p, JSON.stringify(box));
    await page.locator('iframe').screenshot({ path: `${process.env.OUT}/design_${p}.jpg`, type: 'jpeg', quality: 78 });
    await ctx.close();
  }
  await b.close();
})();
