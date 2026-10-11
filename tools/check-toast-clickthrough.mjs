#!/usr/bin/env node
// ─── 提示条点击穿透验证（真 Chromium）──────────────────────────────────────
// 复现并钉住一个真实缺陷：底部居中的提示条（离线启动会打「未检测到可用中继」）
// 固定在 bottom:24px，几何上正好压住输入区按钮；若容器可命中，点击会被吃掉
// （WebKit 的 share-ui-browser 与 Chromium 的 refinement-browser 都以
//  「<div class="toast"> from <div id="toasts"> subtree intercepts pointer events」复现）。
//
// 用法：node tools/check-toast-clickthrough.mjs      （需要已安装 playwright + chromium）
// 该检查不在 npm test 里：它要真浏览器，而 CI 已经用上面两条浏览器回归覆盖同一行为；
// 这个脚本只是让你在本地几秒钟内确认「提示条在场时，控件仍然点得动」。
import fs from 'node:fs';
import { staticSite, openPage } from '../tests/helpers/browser.js';

const { chromium } = await import('playwright').catch(() => { console.log('⏭ 跳过：未安装 Playwright'); process.exit(0); });
if (!fs.existsSync(chromium.executablePath())) { console.log('⏭ 跳过：未安装 Chromium'); process.exit(0); }

const site = await staticSite();
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) failed++; };

try {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: false, args: ['--disable-dev-shm-usage'] });
  try {
    const { context, page } = await openPage(browser, site.base, {
      main: true,
      init: () => localStorage.setItem('dubhe-agent-state-v1', JSON.stringify({ apiKey: 'sk-teamo-QA-fake-xxxxxxxxxxxxxxxx', settings: { theme: 'light' } })),
    });
    try {
      await page.waitForFunction(() => !document.getElementById('boot-screen'), null, { timeout: 60000 });
      await page.evaluate(async () => { const m = await import('./js/ui.js'); m.toast('提示条点击穿透自检', 'ok', 8000); });
      await page.waitForSelector('.toast.in', { state: 'visible', timeout: 15000 });
      const geom = await page.evaluate(() => {
        const t = document.querySelector('.toast.in').getBoundingClientRect();
        const b = document.getElementById('attach-btn').getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return {
          toastVisible: t.width > 0 && t.height > 0,
          btnCenter: [Math.round(cx), Math.round(cy)],
          hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}` : null,
          hitInsideToasts: !!(hit && hit.closest && hit.closest('#toasts')),
          overlayCovers: !(t.right < b.left || t.left > b.right || t.bottom < b.top || t.top > b.bottom),
          wrapPointerEvents: getComputedStyle(document.getElementById('toasts')).pointerEvents,
        };
      });
      check('提示条可见', geom.toastVisible);
      check('提示条几何上盖住附件按钮中心（原缺陷条件成立）', geom.overlayCovers, `btnCenter=${geom.btnCenter}`);
      check('该点不再命中 #toasts 子树', !geom.hitInsideToasts, `hit=${geom.hit}`);
      check('#toasts 计算样式为 pointer-events:none', geom.wrapPointerEvents === 'none', geom.wrapPointerEvents);
      await page.click('#attach-btn', { timeout: 20000 });
      const menuOpen = await page.evaluate(() => { const m = document.getElementById('attach-menu'); return !!m && (m.classList.contains('open') || getComputedStyle(m).display !== 'none'); });
      check('提示条在场时点击 #attach-btn 仍能打开附件菜单', menuOpen);
    } finally { await context.close(); }
  } finally { await browser.close(); }
} finally { await site.close(); }

console.log(failed ? `\n${failed} 项失败` : '\n提示条点击穿透验证通过 ✅（关闭提示条的可点击性不是本项目的设计）');
process.exit(failed ? 1 : 0);
