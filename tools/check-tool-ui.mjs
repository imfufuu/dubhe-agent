// Browser geometry regression (not jsdom): start a local static server first.
// npm install --no-save playwright && npx playwright install chromium
// node tools/check-tool-ui.mjs   (BASE_URL / PLAYWRIGHT_MODULE may override defaults)
import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BASE_URL || 'http://127.0.0.1:8000';
const browser = await chromium.launch();
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (!url.startsWith(base + '/')) return route.abort();
    if (url.includes('/js/main.js')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8') + '\nglobalThis.__uiTest={store,agent,ui};' });
    return route.continue();
  });
  await page.goto(base + '/app.html');
  await page.waitForFunction(() => globalThis.__uiTest?.ui);
  for (const width of [375, 1100]) for (const font of [12, 17]) for (const theme of ['light', 'dark']) for (const separate of [false, true]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(({ font, theme, separate }) => {
      const { store, ui } = __uiTest;
      document.querySelector('#key-modal').classList.remove('open');
      document.documentElement.dataset.theme = theme; document.documentElement.dataset.motion = 'off';
      document.documentElement.style.setProperty('--ui-fs-12px', font + 'px');
      const calls = [
        { id: 'c1', name: 'execute_javascript', args: { code: 'console.log(1)' }, durationMs: 80 },
        { id: 'c2', name: 'execute_python', args: { code: 'print(2)' }, durationMs: 1 },
        { id: 'c3', name: 'write_file', args: { path: 'result.txt', content: 'ok' }, editPreviewBase: { path: 'result.txt', content: '' }, editPreviewSnapshot: { path: 'result.txt', content: 'ok' } },
        { id: 'c4', name: 'list_files', args: {}, durationMs: 1 },
        { id: 'c5', name: 'read_file', args: { path: 'result.txt' }, durationMs: 1 },
      ].map(c => ({ ...c, status: 'ok', settled: true }));
      const tool = c => ({ id: 't' + c.id, role: 'tool', toolCallId: c.id, content: 'ok' });
      const assistant = (id, toolCalls, text = '') => ({ id, role: 'assistant', text, toolCalls, done: true, model: 'deepseek-v4-pro' });
      store.state.messages = [{ id: 'user', role: 'user', text: '运行极简命令检查界面' },
        ...(separate ? [assistant('intro', [], '收到任务。先运行、写入、列出与读取文件。'), ...calls.flatMap(c => [assistant('a' + c.id, [c]), tool(c)])]
          : [assistant('all', calls, '收到任务。先运行、写入、列出与读取文件。'), ...calls.map(tool)]),
        assistant('end', [], '跑完了，全部正常。')];
      ui.rebuildMessages();
    }, { font, theme, separate });
    await page.waitForTimeout(120);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('#messages .ran-commands, #messages .edited-files, #messages .explored-files')]
      .filter(n => n.getClientRects().length && !n.closest('.msg-collapsed'))
      .map(n => ({ top: n.getBoundingClientRect().top, height: n.getBoundingClientRect().height, detail: n.querySelector(':scope > .chip-detail').getBoundingClientRect().height })));
    assert.equal(boxes.length, 4, JSON.stringify({ width, font, theme, separate, boxes }));
    for (const box of boxes) { assert.ok(Math.abs(box.height - boxes[0].height) < 1); assert.equal(box.detail, 0); }
    for (let i = 1; i < boxes.length; i++) assert.ok(Math.abs(boxes[i].top - boxes[i - 1].top - boxes[i - 1].height) < 1, JSON.stringify({ width, font, theme, separate, boxes }));
    checks++;
  }
  // Open a parent, then a child; reopening the parent must not reopen a closed child.
  const group = page.locator('#messages .ran-commands').first();
  await group.locator(':scope > .chip-name').click();
  const child = group.locator('.tool-call-chip').first();
  assert.equal(await child.locator(':scope > .chip-detail').evaluate(n => n.getBoundingClientRect().height), 0);
  await child.locator(':scope > .chip-name').click();
  assert.ok(await child.locator(':scope > .chip-detail').evaluate(n => n.getBoundingClientRect().height) > 0);
  await child.locator(':scope > .chip-name').click();
  assert.equal(await child.locator(':scope > .chip-detail').evaluate(n => n.getBoundingClientRect().height), 0); checks++;
  for (const theme of ['light', 'dark']) {
    const colors = await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme; document.documentElement.dataset.motion = 'on';
      const node = document.querySelector('#messages .ran-commands'); node.classList.add('is-working');
      const text = node.querySelector(':scope > .chip-name');
      const animation = text.getAnimations().find(a => a.animationName === 'tool-ink-polish');
      if (!animation) throw new Error('Missing polish animation'); animation.pause();
      return [0, 800, 1600].map(t => { animation.currentTime = t; const s = getComputedStyle(text); return { color: s.color, opacity: s.opacity }; });
    }, theme);
    assert.ok(new Set(colors.map(c => c.color)).size === 3, JSON.stringify(colors));
    assert.ok(colors.every(c => c.opacity === '1' && !c.color.includes('rgba')), JSON.stringify(colors)); checks++;
  }
  console.log(`Browser regressions: ${checks} passed (mobile/desktop, font sizes, themes, fragments/separate messages, nested folding, opaque color animation).`);
} finally { await browser.close(); }
