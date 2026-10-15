#!/usr/bin/env node
// Optional real-browser regression for V1.8.2 theme boot, language veil and cross-page sweep.
// Usage: BASE_URL=http://127.0.0.1:8787 BROWSERS=chromium PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node tools/check-page-fx.mjs
// Requires Playwright + a compatible installed browser; no gateway/API calls are made.
import assert from 'node:assert/strict';
let engines;
try { engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch (err) {
  console.log(`⏭ Page transition browser check: Playwright is not installed (${err.message})`);
  process.exit(0);
}
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
const browsers = (process.env.BROWSERS || 'chromium').split(',').map((x) => x.trim()).filter(Boolean);
const noisy = /localStorage|frame-ancestors|X-Frame-Options|Refused to display|ERR_BLOCKED_BY_RESPONSE|401|Failed to load resource/;
let checks = 0;
const pass = (condition, label) => { assert.ok(condition, label); checks++; };

for (const name of browsers) {
  const engine = engines[name];
  if (!engine?.launch) throw new Error(`Unknown browser engine: ${name}`);
  const launch = {};
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (name === 'chromium') launch.args = ['--no-sandbox'];
  const browser = await engine.launch(launch);
  try {
    // 首次绘制时已是保存主题，而不是浅色闪一下后靠模块渐变纠正。
    for (const path of ['/index.html?view=nav', '/docs.html', '/app.html']) {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      const page = await context.newPage(); const errors = [];
      page.on('pageerror', (e) => { if (!noisy.test(e.message)) errors.push(e.message); });
      page.on('console', (m) => { if (m.type() === 'error' && !noisy.test(m.text())) errors.push(m.text()); });
      await page.addInitScript(() => {
        localStorage.setItem('dubhe-theme', 'dark'); localStorage.setItem('dubhe-motion', 'on');
        window.__themeFrames = [];
        const sample = () => {
          const root = document.documentElement, bg = getComputedStyle(root).backgroundColor;
          window.__themeFrames.push({ theme: root.dataset.theme, bg, transition: getComputedStyle(root).transitionDuration });
          if (performance.now() < 1200) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.goto(base + path, { waitUntil: 'load' });
      const frames = await page.evaluate(() => window.__themeFrames || []);
      const first = frames[0] || {};
      pass(first.theme === 'dark', `${name} ${path}: the first frame must use dark theme`);
      pass(!frames.some((f) => f.theme === 'dark' && /rgb\((?:2[4-5]\d|[1-9]\d{2}),/.test(f.bg || '')),
        `${name} ${path}: no light background frame may be painted`);
      pass(first.transition === '0s', `${name} ${path}: initial theme interpolation must be locked`);
      pass(errors.length === 0, `${name} ${path}: unexpected browser errors: ${errors.join(' / ')}`);
      await context.close();
    }

    // 深色语言切换先全黑盖满，再替换文案；最后渐显并清除遮罩。
    {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('dubhe-theme', 'dark'); localStorage.setItem('dubhe-motion', 'on'); });
      await page.goto(base + '/index.html?view=nav', { waitUntil: 'load' });
      const result = await page.evaluate(async () => {
        const { setLanguagePreference } = await import('./js/locale.js');
        const from = document.documentElement.lang, target = document.documentElement.dataset.uiLanguage === 'en' ? 'zh' : 'en';
        const expected = target === 'en' ? 'en' : 'zh-CN'; setLanguagePreference(target);
        const t0 = performance.now();
        while (!document.querySelector('.page-veil') && performance.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 16));
        const veil = document.querySelector('.page-veil'); if (!veil) return { missing: true };
        const bg = getComputedStyle(veil).backgroundColor;
        let full = false, changedBeforeFull = false;
        for (let i = 0; i < 280 && veil.isConnected; i++) {
          const opacity = Number(getComputedStyle(veil).opacity), lang = document.documentElement.lang;
          if (opacity > .97) full = true;
          if (lang === expected && !full) changedBeforeFull = true;
          await new Promise((r) => setTimeout(r, 16));
        }
        return { bg, full, changedBeforeFull, lang: document.documentElement.lang, removed: !document.querySelector('.page-veil') };
      });
      pass(result.bg === 'rgb(0, 0, 0)', `${name}: dark language veil is pure black`);
      pass(result.full && !result.changedBeforeFull, `${name}: language changes only while fully covered`);
      pass(result.removed, `${name}: language veil cleans up after fade-in`);
      await context.close();
    }

    // 站内页面链接先扫场，目的页同主题反向揭开；同页 hash 和 reduce-motion 不被劫持。
    {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      const page = await context.newPage();
      page.on('pageerror', (e) => { if (!noisy.test(e.message)) throw e; });
      await page.addInitScript(() => { localStorage.setItem('dubhe-theme', 'dark'); localStorage.setItem('dubhe-motion', 'on'); });
      await page.goto(base + '/index.html?view=nav', { waitUntil: 'load' });
      const leaving = await page.evaluate(async () => {
        document.querySelector('.nav-actions a.cta').click();
        await new Promise((r) => setTimeout(r, 60));
        const cs = getComputedStyle(document.documentElement, '::before');
        return document.documentElement.classList.contains('fx-leaving') && cs.zIndex === '2147483000';
      });
      pass(leaving, `${name}: leaving page has its wipe layer`);
      await page.waitForURL(/app\.html/, { timeout: 15000 });
      const entering = await page.evaluate(() => ({
        active: document.documentElement.classList.contains('fx-entering'),
        from: document.documentElement.dataset.fxFrom,
        dark: document.documentElement.dataset.theme === 'dark',
      }));
      pass(entering.active && entering.from === 'index.html' && entering.dark, `${name}: app enters from the correct dark page`);
      await page.waitForTimeout(720);
      pass(await page.evaluate(() => !document.documentElement.classList.contains('fx-entering')), `${name}: entering wipe settles`);
      await context.close();
    }

    {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('dubhe-theme', 'dark'); localStorage.setItem('dubhe-motion', 'off'); });
      await page.goto(base + '/index.html?view=nav', { waitUntil: 'load' });
      const samePage = await page.evaluate(async () => {
        document.querySelector('.nav-focus a[href="#capabilities"]').click();
        await new Promise((r) => setTimeout(r, 520));
        return { leaving: document.documentElement.classList.contains('fx-leaving'), scrolled: window.scrollY > 100 };
      });
      pass(!samePage.leaving && samePage.scrolled, `${name}: in-page anchors are not intercepted`);
      await page.evaluate(() => { document.querySelector('.nav-actions a.cta').click(); });
      await page.waitForURL(/app\.html/, { timeout: 15000 });
      pass(await page.evaluate(() => !document.documentElement.classList.contains('fx-entering')),
        `${name}: disabled motion never shows a wipe overlay`);
      await context.close();
    }

    // 文档页分区用原生同文档 View Transition（若浏览器不支持，则仍必须正常换页）。
    {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem('dubhe-theme', 'dark'); localStorage.setItem('dubhe-motion', 'on'); });
      await page.goto(base + '/docs.html#changelog', { waitUntil: 'load' });
      const result = await page.evaluate(async () => {
        const original = document.startViewTransition?.bind(document); let started = false;
        if (original) document.startViewTransition = (callback) => { started = true; return original(callback); };
        document.querySelector('.doc-tabs a[href="#privacy"]').click();
        await new Promise((r) => setTimeout(r, 700));
        return { supported: !!original, started, active: document.querySelector('.doc-tab.active')?.dataset.page,
          visible: !!document.getElementById('page-privacy')?.classList.contains('active') };
      });
      pass(result.active === 'privacy' && result.visible, `${name}: docs hash route still changes section`);
      if (result.supported) pass(result.started, `${name}: docs section uses View Transition`);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`${name}: page transition regression checks passed.`);
}
console.log(`Page FX checks: ${checks} passed.`);
