// 旗帜在切换标签页后「短暂显现又整批隐身」的回归：字体显式加载 / 恢复 / 可见占位 / PUA 渲染。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { FLAG_FACES, FLAG_READY_ATTR, ensureFlagFonts, installFlagFontRecovery } from '../js/flag-fonts.js';
import { flagMarkup, flagSequence, puaCodeFor, unicodeFlagSequence, FLAG_COPY_PLACEHOLDER, FLAG_COPY_MAP } from '../js/flag-directive.js';
import { flagCopyText, installFlagCopyHandler } from '../js/flag-copy.js';
import { regionalFlags, subdivisionFlags, puaFlags } from '../js/flag-registry.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const makeFonts = () => {
  const loaded = new Set();
  const fonts = {
    check: (spec) => loaded.has(spec),
    load: async (spec) => { loaded.add(spec); return [{ family: spec }]; },
    _loaded: loaded,
    calls: 0,
  };
  const rawLoad = fonts.load;
  fonts.load = async (spec, text) => { fonts.calls++; return rawLoad(spec, text); };
  return fonts;
};

test('两个旗帜面都有真实存在的代表性字符，且 PUA 覆盖绝大多数旗帜', () => {
  assert.equal(FLAG_FACES.length, 2);
  assert.ok(FLAG_FACES.some((f) => f.family === 'BabelStone Flags' && f.file.endsWith('flags.woff2')));
  assert.ok(FLAG_FACES.some((f) => f.family === 'BabelStone Flags PUA' && f.file.endsWith('flags-pua.ttf')));
  const covered = [...regionalFlags, ...subdivisionFlags].filter((id) => !!puaCodeFor(id));
  assert.ok(covered.length >= 270, `PUA 覆盖 ${covered.length}/274`);
  assert.equal(puaCodeFor('gb-cym'), puaCodeFor('gb-wls'));
  assert.equal(puaCodeFor('xe'), null, '无映射时调用方回退到 Unicode 序列');
  assert.equal(Object.keys(puaFlags).length, 263);
});

test('默认旗帜渲染为 PUA 单码位，并带可见占位代码', () => {
  const m = flagMarkup('::flag[us|美国]::');
  assert.match(m.html, /class="md-flag md-flag-pua"/);
  assert.match(m.html, /data-code="US"/);
  assert.match(m.html, /aria-label="美国"/);
  assert.equal([...m.html.matchAll(/[\uE000-\uF8FF]/gu)].length >= 1, true);
  assert.equal(flagSequence('rainbow').puaFont, false, 'ZWJ 旗帜无 PUA 映射，保持序列');
  assert.match(m.html, /role="img"/);
});

test('ensureFlagFonts 显式加载缺失字体，并在字体被后台卸载后重载', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  const fonts = makeFonts();
  const first = await ensureFlagFonts({ fonts, doc });
  assert.equal(first.loaded, 2);
  assert.equal(first.ok, true);
  assert.equal(fonts.calls, 2);
  assert.equal(doc.documentElement.getAttribute(FLAG_READY_ATTR), 'ready');
  const again = await ensureFlagFonts({ fonts, doc });
  assert.equal(again.missing, 0, '已加载时不应重复下载');
  assert.equal(fonts.calls, 2);
  // 模拟浏览器在后台标签页丢弃字体
  fonts._loaded.delete('16px "BabelStone Flags PUA"');
  const recovered = await ensureFlagFonts({ fonts, doc });
  assert.equal(recovered.missing, 1);
  assert.equal(fonts.calls, 3);
  assert.equal(doc.documentElement.getAttribute(FLAG_READY_ATTR), 'ready');
  dom.window.close();
});

test('加载失败时保持 pending，占位不会让旗帜整批隐身', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const doc = dom.window.document;
  const fonts = { check: () => false, load: async () => { throw new Error('offline'); } };
  const result = await ensureFlagFonts({ fonts, doc });
  assert.equal(result.ok, false);
  assert.equal(doc.documentElement.getAttribute(FLAG_READY_ATTR), 'pending');
  dom.window.close();
});

test('无 FontFaceSet 的老浏览器直接标记 ready，不显示占位', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  await ensureFlagFonts({ fonts: null, doc: dom.window.document });
  assert.equal(dom.window.document.documentElement.getAttribute(FLAG_READY_ATTR), 'ready');
  dom.window.close();
});

test('installFlagFontRecovery 在标签页重新可见时复查重载', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const fonts = makeFonts();
  const recovery = installFlagFontRecovery({ fonts, doc });
  assert.ok(recovery);
  await recovery.ready; // 等待启动时的首次加载完成
  assert.equal(fonts.calls, 2);
  fonts._loaded.delete('16px "BabelStone Flags"');
  doc.dispatchEvent(new dom.window.Event('visibilitychange'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fonts.calls, 3, '恢复可见后重新加载被丢弃的字体');
  recovery.dispose();
  dom.window.close();
});

test('接线与官网研究结论：CSS、启动、字体面与报告一致', () => {
  const css = read('css/styles.css');
  assert.match(css, /font-variant-emoji: text/);
  assert.match(css, /html\[data-flags-ready="pending"\] \.md-flag::after/);
  assert.match(css, /content: attr\(data-code\)/);
  assert.match(read('js/main.js'), /installFlagFontRecovery\(\)/);
  for (const rel of ['assets/fonts-lazy/index.css', 'assets/fonts-lazy/babelstone-extra.css']) {
    const sheet = read(rel);
    assert.match(sheet, /font-family: "BabelStone Flags"[^}]*font-display: swap/, `${rel} 必须保留 swap`);
    assert.match(sheet, /font-family: "BabelStone Flags PUA"/);
    assert.doesNotMatch(sheet, /font-display: (?:optional|fallback)/, 'optional/fallback 的 swap period 会让后台标签页字体永不交换');
  }
  const report = read('FLAG_RENDERING_REPORT.md');
  for (const needle of ['babelstone.co.uk/Fonts/Flags.html', 'COLR/CPAL', 'ccmp', 'font-variant-emoji', 'visibilitychange', 'PUA']) {
    assert.ok(report.includes(needle), `报告应说明 ${needle}`);
  }
});

test('复制语义：有 Unicode 表示的旗帜还原成 emoji，纯 PUA 设计复制为占位符', () => {
  const usPua = puaCodeFor('us');
  assert.equal(flagCopyText(usPua), '🇺🇸');
  assert.equal(flagCopyText(usPua), unicodeFlagSequence('us'));
  assert.equal(flagCopyText(puaCodeFor('at-1')), unicodeFlagSequence('at-1'));
  assert.ok(unicodeFlagSequence('at-1').includes(String.fromCodePoint(0xe007f)));
  assert.equal(flagCopyText(String.fromCodePoint(0xf000)), FLAG_COPY_PLACEHOLDER);
  assert.equal(flagCopyText('plain 🇯🇵 text'), 'plain 🇯🇵 text');
  assert.equal(flagCopyText(`A ${usPua} B ${String.fromCodePoint(0xf000)} C`), `A 🇺🇸 B ${FLAG_COPY_PLACEHOLDER} C`);
  assert.equal(FLAG_COPY_MAP.size, 267);
  assert.ok([...FLAG_COPY_MAP.values()].every((v) => v === FLAG_COPY_PLACEHOLDER || v.length > 0));
});

test('copy 事件只在选区含 PUA 时改写剪贴板，纯文本与富文本都还原', async () => {
  const dom = new JSDOM(`<!doctype html><html><body><div id="x">A ${puaCodeFor('us')} B ${String.fromCodePoint(0xf000)} C 🇯🇵</div><div id="y">ordinary text</div></body></html>`);
  const doc = dom.window.document;
  const handler = installFlagCopyHandler({ doc });
  assert.ok(handler);
  const copy = (node) => {
    const range = doc.createRange(); range.selectNodeContents(node);
    const sel = dom.window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const clipboard = { data: {}, setData(type, value) { this.data[type] = value; } };
    const event = new dom.window.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: clipboard });
    doc.dispatchEvent(event);
    return { clipboard, event };
  };
  const first = copy(doc.getElementById('x'));
  assert.equal(first.clipboard.data['text/plain'], `A 🇺🇸 B ${FLAG_COPY_PLACEHOLDER} C 🇯🇵`);
  assert.match(first.clipboard.data['text/html'], /🇺🇸/);
  assert.equal(first.event.defaultPrevented, true);
  const second = copy(doc.getElementById('y'));
  assert.equal(second.clipboard.data['text/plain'], undefined, '普通复制不干预');
  assert.equal(second.event.defaultPrevented, false);
  handler.dispose();
  dom.window.close();
});
