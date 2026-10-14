import assert from 'node:assert/strict';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
for (const engine of (process.env.BROWSERS || 'chromium,webkit').split(',')) {
  const browser = await engines[engine].launch(); let checks = 0;
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' });
      await page.goto(base + '/index.html?view=nav');
      await page.waitForFunction(() => document.documentElement.classList.contains('open'));
      await page.evaluate(async () => { await document.fonts.ready; document.documentElement.dataset.motion = 'off'; });
      await page.evaluate(() => window.scrollTo({ top: 600, behavior: 'instant' }));
      await page.locator('.nav .brand').click();
      await page.waitForFunction(() => window.scrollY < 2);
      assert.equal(await page.locator('.site').evaluate(n => getComputedStyle(n).visibility), 'visible');
      assert.equal(await page.locator('html').evaluate(n => n.classList.contains('gate')), false);
      assert.ok(await page.locator('#hero').isVisible()); checks++;
      for (const motion of ['off', 'on']) {
        await page.evaluate(motion => { document.documentElement.dataset.motion = motion; window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); }, motion);
        await page.waitForTimeout(100);
        for (const language of ['en', 'zh-CN']) {
          const toggle = page.locator('footer [data-language-toggle]');
          const before = await toggle.evaluate(n => ({ top: n.getBoundingClientRect().top, left: window.scrollX }));
          await toggle.click();
          await page.waitForFunction(lang => document.documentElement.lang === lang, language);
          await page.waitForTimeout(motion === 'on' ? 1500 : 600);
          const after = await toggle.evaluate(n => ({ top: n.getBoundingClientRect().top, left: window.scrollX }));
          assert.ok(Math.abs(after.top - before.top) <= 2, `${engine}/${width}/${motion}/${language}: ${JSON.stringify({ before, after })}`);
          assert.equal(after.left, before.left); checks++;
        }
      }
      // Non-footer programmatic language changes keep the currently-read section anchored.
      await page.evaluate(() => { document.documentElement.dataset.motion = 'off'; const section = document.querySelector('#capabilities'); window.scrollTo({ top: section.offsetTop + 100, behavior: 'instant' }); });
      const before = await page.locator('#capabilities').evaluate(n => n.getBoundingClientRect().top);
      await page.evaluate(async () => { const { setLanguagePreference } = await import('./js/locale.js'); setLanguagePreference('en'); });
      await page.waitForTimeout(650);
      const after = await page.locator('#capabilities').evaluate(n => n.getBoundingClientRect().top);
      assert.ok(Math.abs(after - before) <= 2, `section moved ${after - before}px`); checks++;
      await page.locator('.nav .brand').click(); await page.waitForFunction(() => window.scrollY < 2); assert.ok(await page.locator('#hero').isVisible()); checks++;
      await page.close();
    }
    console.log(`${engine}: ${checks} homepage navigation/language-position checks passed.`);
  } finally { await browser.close(); }
}
