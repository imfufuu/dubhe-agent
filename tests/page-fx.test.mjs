// V1.8.2 UI 回归：首帧主题锁定、CSP-safe 深色语言遮罩、跨页扫场及同文档分区过渡。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { FX, installPageFx, motionAllowed, veilFade } from '../js/page-fx.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const bootSource = read('../js/theme-boot.js');
const pageFxCss = read('../css/page-fx.css');

function makeDom(path = '/index.html') {
  return new JSDOM(`<!doctype html><html><head></head><body></body></html>`, {
    url: `https://dubhe.test${path}`, pretendToBeVisual: true,
  });
}

function bootDom({ shared, legacy, state, lang, systemDark = false, mark, fallback = 'system' } = {}) {
  const dom = new JSDOM(`<!doctype html><html lang="zh-CN" data-theme="light"><head>
    <meta name="theme-color" content="#f6f4ef">
    <script src="/js/theme-boot.js" data-theme-fallback="${fallback}" data-theme-color-dark="#0b0b0b" data-theme-color-light="#fff"></script>
  </head><body></body></html>`, { url: 'https://dubhe.test/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  if (lang) Object.defineProperty(w.navigator, 'language', { configurable: true, value: lang });
  Object.defineProperty(w, 'matchMedia', { configurable: true, value: () => ({ matches: systemDark, media: '(prefers-color-scheme: dark)' }) });
  if (shared != null) w.localStorage.setItem('dubhe-theme', shared);
  if (legacy != null) w.localStorage.setItem('dubhe-home-theme', legacy);
  if (state != null) w.localStorage.setItem('dubhe-agent-state-v1-v2', JSON.stringify(state));
  if (mark != null) w.sessionStorage.setItem('dubhe-page-fx', JSON.stringify(mark));
  w.eval(bootSource);
  return dom;
}

function fakeView(dom) {
  const w = dom.window;
  const timeouts = new Map();
  let nextId = 1;
  const view = {
    top: null, self: null,
    location: { origin: w.location.origin, pathname: w.location.pathname, href: w.location.href },
    sessionStorage: w.sessionStorage,
    setTimeout(fn, ms) { const id = nextId++; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    addEventListener: w.addEventListener.bind(w),
    removeEventListener: w.removeEventListener.bind(w),
    timeouts,
  };
  view.top = view; view.self = view;
  return view;
}

function dispatchClick(dom, target, init = {}) {
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

test('theme-boot runs before all styles on every rendered page; shared sheet is present', () => {
  const entries = [
    ['../index.html', 'css/home.css'],
    ['../docs.html', '<style>'],
    ['../app.html', 'css/styles.css'],
    ['../demo/chat-card.html', '../css/styles.css'],
  ];
  for (const [path, mainCss] of entries) {
    const html = read(path);
    const bootAt = html.indexOf('theme-boot.js');
    const cssAt = html.indexOf(mainCss);
    assert.ok(bootAt >= 0 && cssAt >= 0 && bootAt < cssAt, `${path}: 首帧脚本必须早于任何主样式`);
    if (!path.includes('chat-card')) {
      const themeMetaAt = html.indexOf('name="theme-color"');
      assert.ok(themeMetaAt >= 0 && themeMetaAt < bootAt, `${path}: theme-color meta 必须先于 theme-boot，首帧系统栏才可正确取色`);
    }
    assert.match(html, /page-fx\.css/, `${path}: 必须加载跨页/语言遮罩样式`);
  }
  const app = read('../app.html');
  const home = read('../index.html');
  assert.match(app, /Content-Security-Policy/); assert.match(home, /Content-Security-Policy/);
  assert.doesNotMatch(app, /<meta name="view-transition"/);
  assert.doesNotMatch(home, /<meta name="view-transition"/);
  assert.match(pageFxCss, /html\.fx-leaving::before/);
  assert.match(pageFxCss, /html\.fx-entering::before/);
  assert.match(pageFxCss, /@keyframes fx-wipe-cover/);
  assert.match(pageFxCss, /@keyframes fx-wipe-reveal/);
});

test('theme-boot prefers a valid shared theme, then valid legacy, then saved app state', () => {
  const a = bootDom({ shared: 'dark', legacy: 'light', state: { settings: { theme: 'light' } } });
  assert.equal(a.window.document.documentElement.dataset.theme, 'dark');
  assert.equal(a.window.document.querySelector('meta[name="theme-color"]').content, '#0b0b0b');
  const b = bootDom({ shared: 'invalid', legacy: 'dark', state: { settings: { theme: 'light' } } });
  assert.equal(b.window.document.documentElement.dataset.theme, 'dark');
  const c = bootDom({ shared: 'invalid', legacy: 'invalid', state: { settings: { theme: 'dark' } } });
  assert.equal(c.window.document.documentElement.dataset.theme, 'dark');
  const d = bootDom({ shared: 'invalid', legacy: 'invalid', state: { settings: { theme: 'bad' } }, fallback: 'light' });
  assert.equal(d.window.document.documentElement.dataset.theme, 'light');
  for (const dom of [a, b, c, d]) dom.window.close();
});

test('theme-boot follows system fallback and prevents a first-frame light flash on a dark OS', () => {
  const dom = bootDom({ systemDark: true, fallback: 'system', lang: 'en-US' });
  const root = dom.window.document.documentElement;
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.classList.contains('theme-boot'), true);
  assert.equal(root.lang, 'en');
  assert.equal(root.dataset.uiLanguage, 'en');
  assert.equal(dom.window.localStorage.getItem('dubhe-theme'), 'dark', 'System fallback should be persisted so the next internal page gets the same theme');
  dom.window.close();
});

test('theme-boot applies in-flight page marker once and removes it from session storage', () => {
  const dom = bootDom({ shared: 'dark', mark: { t: Date.now(), from: 'index.html' } });
  const root = dom.window.document.documentElement;
  assert.equal(root.classList.contains('fx-entering'), true);
  assert.equal(root.dataset.fxFrom, 'index.html');
  assert.equal(dom.window.sessionStorage.getItem('dubhe-page-fx'), null);
  dom.window.close();
});

test('theme-boot uses the app-state theme when shared and legacy keys are missing', () => {
  const dom = bootDom({ state: { settings: { theme: 'dark' } }, fallback: 'light' });
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  dom.window.close();
});

test('motionAllowed respects explicit off/on before system preference', () => {
  const dom = makeDom();
  const root = dom.window.document.documentElement;
  Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  assert.equal(motionAllowed(dom.window.document), false);
  root.dataset.motion = 'on'; assert.equal(motionAllowed(dom.window.document), true);
  root.dataset.motion = 'off'; assert.equal(motionAllowed(dom.window.document), false);
  Object.defineProperty(dom.window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  delete root.dataset.motion; assert.equal(motionAllowed(dom.window.document), true);
  dom.window.close();
});

test('veilFade is CSP-safe (class only), waits for full cover before callback, then removes veil', async () => {
  const dom = makeDom();
  const { window: w } = dom; const doc = w.document;
  doc.documentElement.dataset.motion = 'on';
  const animations = [];
  w.Element.prototype.animate = function (frames, options) {
    const record = { frames, options, el: this, cancelled: false };
    animations.push(record);
    return { finished: Promise.resolve(), cancel() { record.cancelled = true; } };
  };
  let observed;
  const done = await veilFade(doc, () => {
    const veil = doc.querySelector('.page-veil');
    observed = { exists: !!veil, className: veil?.className, style: veil?.getAttribute('style'), background: veil && w.getComputedStyle(veil).backgroundColor };
    return 'switched';
  }, { inMs: 12, outMs: 18 });
  assert.equal(done, 'switched');
  assert.deepEqual(animations.map((a) => [a.options.duration, a.options.fill]), [[12, 'forwards'], [18, 'forwards']]);
  assert.deepEqual(observed, { exists: true, className: 'page-veil', style: null, background: 'rgba(0, 0, 0, 0)' });
  assert.equal(doc.querySelector('.page-veil'), null);
  dom.window.close();
});

test('veilFade honors reduced motion without leaving an invisible overlay behind', async () => {
  const dom = makeDom(); const { window: w } = dom; const doc = w.document;
  Object.defineProperty(w, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  let called = false;
  assert.equal(await veilFade(doc, () => { called = true; return 7; }), 7);
  assert.equal(called, true);
  assert.equal(doc.querySelector('.page-veil'), null);
  dom.window.close();
});

test('veilFade cancels an older in-flight transition when language is toggled again', async () => {
  const dom = makeDom(); const { window: w } = dom; const doc = w.document;
  doc.documentElement.dataset.motion = 'on';
  const pending = [];
  w.Element.prototype.animate = function (_frames, options) {
    let resolve, reject;
    const finished = new Promise((res, rej) => { resolve = res; reject = rej; });
    const rec = { options, resolve, reject, cancelled: false };
    pending.push(rec);
    return { finished, cancel() { rec.cancelled = true; const e = new Error('cancelled'); e.name = 'AbortError'; reject(e); } };
  };
  const first = veilFade(doc, () => 'old', { inMs: 1000 });
  assert.ok(doc.querySelector('.page-veil'));
  const second = veilFade(doc, () => 'new', { inMs: 1000 });
  assert.equal(pending[0].cancelled, true);
  // 第二个的入场完成后，函数执行，再把它的离场完成。
  pending[1].resolve();
  await Promise.resolve(); await Promise.resolve();
  pending[2].resolve();
  assert.equal(await first, undefined);
  assert.equal(await second, 'new');
  assert.equal(doc.querySelector('.page-veil'), null);
  dom.window.close();
});

test('installPageFx intercepts same-origin HTML links, records source, and honors modifiers/external links', () => {
  const dom = new JSDOM('<!doctype html><body><a id="go" href="./docs.html">Docs</a><a id="ext" target="_blank" href="https://example.org">External</a><a id="hash" href="#section">Hash</a></body>', {
    url: 'https://dubhe.test/index.html', pretendToBeVisual: true,
  });
  const { window: w } = dom; const doc = w.document; const view = fakeView(dom);
  doc.documentElement.dataset.motion = 'on';
  assert.equal(installPageFx(doc, view), true);
  const a = doc.querySelector('#go');
  const event = dispatchClick(dom, a);
  assert.equal(event.defaultPrevented, true);
  assert.equal(doc.documentElement.classList.contains('fx-leaving'), true);
  const mark = JSON.parse(w.sessionStorage.getItem(FX.markKey));
  assert.equal(mark.from, 'index.html'); assert.ok(mark.t > 0);
  assert.equal(view.timeouts.size, 1);
  const timer = [...view.timeouts.values()][0]; assert.equal(timer.ms, FX.wipe);
  timer.fn();
  assert.equal(view.location.href, 'https://dubhe.test/docs.html');
  assert.equal(view.timeouts.size, 0);
  assert.equal(dispatchClick(dom, doc.querySelector('#ext')).defaultPrevented, false);
  assert.equal(dispatchClick(dom, doc.querySelector('#hash')).defaultPrevented, false);
  // 对同一文档再次安装是幂等的，不重复接管。
  assert.equal(installPageFx(doc, view), true);
  dom.window.close();
});

test('installPageFx bypasses animation when reduced motion is requested and retains ordinary navigation', () => {
  const dom = new JSDOM('<!doctype html><body><a href="./docs.html">Docs</a></body>', { url: 'https://dubhe.test/index.html' });
  const { window: w } = dom; const doc = w.document; const view = fakeView(dom);
  Object.defineProperty(w, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
  assert.equal(installPageFx(doc, view), true);
  const event = dispatchClick(dom, doc.querySelector('a'));
  assert.equal(event.defaultPrevented, false);
  assert.equal(doc.documentElement.classList.contains('fx-leaving'), false);
  assert.equal(w.sessionStorage.getItem(FX.markKey), null);
  dom.window.close();
});

test('docs hash router has a same-document transition path with an instant scroll reset', () => {
  const docs = read('../docs.html');
  assert.match(docs, /document\.startViewTransition\(function \(\) \{ mutate\(\); inVt = false; \}\)/);
  assert.match(docs, /window\.addEventListener\('hashchange',[\s\S]*?swapWithTransition/);
  assert.match(docs, /behavior: inVt \? 'instant' : 'smooth'/);
  assert.match(pageFxCss, /::view-transition-old\(root\)/);
  assert.match(pageFxCss, /::view-transition-new\(root\)/);
});
