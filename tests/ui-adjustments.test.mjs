import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { paintEditFoldContent } from '../js/ui-editpreview.js';
import { paintReasoningBlocks } from '../js/ui-reasoning-motion.js';
import { renderQuickChart, renderQuickDiagram } from '../js/quickviz.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('offline model menu uses LOCAL in the provider column and keeps only the muted-gray local badge', () => {
  const picker = read('../js/ui-model-picker.js');
  const css = read('../css/styles.css');
  assert.match(picker, /const LOCAL_PROVIDER_ICON = LOCAL_PROVIDER_ICON_SVG;/);
  assert.match(read('../js/icons.js'), /export const LOCAL_PROVIDER_ICON_SVG = '<svg class="p-icon local-provider-icon" viewBox="0 0 24 24"/);
  assert.match(picker, /const isLocalGroup = groups\.get\(p\)\.some\(\(model\) => model\.localModel\)/);
  assert.match(picker, /isLocalGroup \? LOCAL_PROVIDER_ICON : providerIcon\(p\)/);
  assert.match(picker, /isLocalGroup \? 'LOCAL' : p/);
  assert.match(picker, /class="badge local-model-badge">\$\{localeText\('本地', 'Local'\)\}<\/span>/);
  assert.doesNotMatch(picker, /localState|localeText\('已就绪', 'Ready'\)|localeText\('未选择', 'Not selected'\)|localeText\('检查中', 'Checking'\)/);
  assert.match(css, /\.badge\.local-model-badge \{ color: var\(--fg-3\); border-color: var\(--line-2\); \}/);
  assert.match(css, /\.dd-item\.active \.badge\.local-model-badge \{ color: var\(--bg\); border-color: var\(--bg\); \}/);
  assert.match(css, /\.dd-group-title \.local-provider-icon \{[^}]*width: 12px; height: 12px; color: var\(--fg-3\)/);
});

test('salutation input includes its trailing local status and keeps the check/cross inside the input at the far right', () => {
  const settings = read('../js/settings.js');
  const css = read('../css/styles.css');
  const app = read('../app.html');
  assert.match(settings, /status\.textContent = result\.ok \? '✓' : '✗';/);
  assert.match(settings, /salutationCheckTimer = setInterval\(refreshSalutation, 1000\)/);
  assert.match(app, /<div class="user-salutation-input-wrap">[\s\S]*?id="set-user-salutation"[^>]*aria-describedby="set-user-salutation-status"[\s\S]*?id="set-user-salutation-status"[\s\S]*?<\/div>[\s\S]*?<button id="save-user-salutation"/);
  assert.match(css, /\.user-salutation-control \{ display: flex; align-items: center; gap: 7px; min-width: 0; width: 230px;/, '整组控件与上方 230px 菜单等宽，输入框收缩为剩余宽度');
  assert.match(css, /\.user-salutation-input-wrap \{ position: relative; flex: 1 1 0; width: auto;/);
  assert.match(css, /\.user-salutation-status \{ position: absolute; top: 50%; right: 9px;/);
  assert.match(css, /\.user-salutation-control \.set-input \{ display: block; width: 100%;[^}]*padding: 7px 34px 7px 9px/);
  assert.match(css, /\.user-salutation-control \.mini-btn \{ flex: 0 0 auto; white-space: nowrap; \}/);
  assert.doesNotMatch(css, /\.user-salutation-status \{ flex: 0 0 58px/);
  assert.match(read('../js/user-salutation.js'), /export function validateUserSalutation/);
});

test('tool capability table stays fully expanded; local-model info toggles across the whole animated row', () => {
  const app = read('../app.html');
  const settings = read('../js/settings.js');
  const css = read('../css/styles.css');
  const capabilityMarkup = app.slice(app.indexOf('id="set-capability-sec"'), app.indexOf('id="set-budget-sec"'));
  assert.match(capabilityMarkup, /<div id="set-capability-details"[\s\S]*?id="set-capability-table-body"/);
  assert.doesNotMatch(capabilityMarkup, /<details|<summary/);
  assert.match(css, /\.set-capability-details \.capability-detail-panel \{ display: grid; grid-template-rows: 1fr; opacity: 1/);
  const localStart = app.indexOf('id="offline-model-details"');
  const localDetails = app.slice(localStart, app.indexOf('</section>', localStart));
  assert.match(localDetails, /<button class="offline-model-summary"[^>]*aria-expanded="false"[^>]*aria-controls="offline-model-detail-panel"[^>]*>本地文件、内存估算与模型许可<svg class="offline-model-chevron"/);
  assert.match(localDetails, /<div class="offline-model-detail-panel"[^>]*aria-hidden="true" inert/);
  assert.match(settings, /offlineDetailsToggle\.addEventListener\('click'/);
  assert.match(settings, /offlineDetailsPanel\.inert = !expanded/);
  assert.match(settings, /statusEl\.classList\.toggle\('is-loading', offlineModelBusy \|\| offlineModelStatusChecking\)/);
  assert.match(css, /\.offline-model-summary \{[\s\S]*?width: 100%;[\s\S]*?text-align: left/s);
  assert.match(css, /\.offline-model-summary \{[^}]*-webkit-tap-highlight-color: transparent/);
  assert.match(css, /\.offline-model-chevron \{[^}]*width: 12px; height: 12px[^}]*stroke: currentColor/);
  assert.doesNotMatch(css, /\.offline-model-summary::before/);
  assert.match(css, /\.offline-model-details \.set-sub \{ margin-top: 3px; line-height: 1\.38/);
  assert.match(css, /\.offline-model-details\[aria-expanded="true"\] \.offline-model-detail-panel \{ grid-template-rows: 1fr; opacity: 1/);
  assert.match(css, /transition: grid-template-rows \.28s var\(--ease\), opacity \.2s/);
  assert.match(css, /\.offline-model-status\.is-loading::before \{[^}]*border-radius: 50%;[^}]*animation: offlineModelSpin/);
  assert.match(css, /@keyframes offlineModelSpin \{ to \{ transform: rotate\(360deg\); \} \}/);
});

test('edited-file diffs default open while live, are individually collapsible, and render only green/red changed lines', () => {
  const dom = new JSDOM('<div id="edited" class="edited-files"></div>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const fold = dom.window.document.querySelector('#edited');
    const preview = {
      path: 'src/example.js', modeLabel: 'Replace', added: 1, removed: 1, chars: 12,
      changes: [
        { kind: 'del', no: 4, text: 'oldValue();' },
        { kind: 'add', no: 4, text: 'newValue();' },
      ],
    };
    paintEditFoldContent(fold, { label: 'Edited File', paths: [preview.path], preview, live: true, state: 'Writing…' });
    const row = fold.querySelector('.edit-path-row');
    const toggle = row.querySelector('.edit-path');
    assert.equal(row.classList.contains('expanded'), true, 'live output expands its diff by default');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(row.querySelectorAll('.ep-add').length, 1);
    assert.equal(row.querySelectorAll('.ep-del').length, 1);
    assert.match(row.querySelector('.ep-add').textContent, /newValue/);
    assert.match(row.querySelector('.ep-del').textContent, /oldValue/);
    assert.equal(row.querySelector('pre'), null, 'the preview contains changed lines, not a full-file dump');
    toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(row.classList.contains('expanded'), false, 'a user can collapse an individual live diff');
    paintEditFoldContent(fold, { label: 'Edited File', paths: [preview.path], preview, live: true, state: 'Writing…' });
    assert.equal(row.classList.contains('expanded'), false, 'stream updates respect the user’s collapse choice');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    dom.window.close();
  }
  const css = read('../css/styles.css');
  assert.match(css, /\.diff-add, \.edit-preview \.ep-add \{ color: #16803c; \}/);
  assert.match(css, /\.diff-del, \.edit-preview \.ep-del \{ color: #c53434; \}/);
});

test('reasoning menu requires actual displayable content; GPT uses only bold summaries', () => {
  const ui = read('../js/ui.js');
  assert.match(ui, /const showThink = thinkOn && typeof m\.reasoning === 'string' && !!m\.reasoning\.trim\(\);/);
  assert.match(ui, /const displayableThink = showThink && \(!gptSummaryOnly \|\| summaryItems\.length > 0\);/);
  assert.match(ui, /if \(displayableThink\) \{/);
  assert.match(ui, /return !isGptModel\(model\) \|\| reasoningSummaryItems\(x\.reasoning, model\)\.length > 0;/);
  assert.doesNotMatch(ui, /hiddenThink|thinkPending|reasoning_tokens/);
});

test('chart expand buttons stay anchored to their outer window while only the SVG viewport scrolls', () => {
  const css = read('../css/styles.css');
  const dom = new JSDOM('<main id="charts"></main>');
  const host = dom.window.document.querySelector('#charts');
  host.insertAdjacentHTML('beforeend', renderQuickChart('bar', ['A, 1', 'B, 2'].join('\n'), 'Sales'));
  host.insertAdjacentHTML('beforeend', renderQuickDiagram('flow', 'Start -> Review -> Done', 'Pipeline'));
  const chart = host.querySelector('.md-chart');
  const diagram = host.querySelector('.md-diagram');
  for (const box of [chart, diagram]) {
    assert.equal(box.querySelector('.md-chart-expand').parentElement, box);
    const svg = box.querySelector('.md-chart-svg');
    assert.equal(svg.parentElement, box.querySelector('.md-chart-viewport, .md-diagram-viewport'));
  }
  assert.match(css, /\.md-chart, \.md-diagram \{ position: relative; margin: 12px 0; overflow: visible; \}/);
  assert.match(css, /\.md-chart-viewport, \.md-diagram-viewport \{ width: 100%; min-width: 0; overflow-x: auto;/);
  dom.window.close();
});

test('reasoning viewports scroll to the newest streamed summary and full-text lines', async () => {
  const dom = new JSDOM('<div id="full"></div><div id="summary"></div>', { pretendToBeVisual: true });
  const full = dom.window.document.querySelector('#full');
  const summary = dom.window.document.querySelector('#summary');
  let fullHeight = 360;
  let summaryHeight = 240;
  Object.defineProperty(full, 'scrollHeight', { configurable: true, get: () => fullHeight });
  Object.defineProperty(full, 'clientHeight', { configurable: true, get: () => 72 });
  Object.defineProperty(summary, 'scrollHeight', { configurable: true, get: () => summaryHeight });
  Object.defineProperty(summary, 'clientHeight', { configurable: true, get: () => 96 });
  paintReasoningBlocks(full, '<p>one</p><p>two</p><p>three</p>');
  paintReasoningBlocks(summary, '<div>summary one</div><div>summary two</div>');
  assert.equal(full.scrollTop, 288);
  assert.equal(summary.scrollTop, 144);
  fullHeight = 540;
  summaryHeight = 360;
  paintReasoningBlocks(full, '<p>one</p><p>two</p><p>three</p><p>four</p>', { animate: true });
  paintReasoningBlocks(summary, '<div>summary one</div><div>summary two</div><div>summary three</div>', { animate: true });
  await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  assert.equal(full.scrollTop, 468);
  assert.equal(summary.scrollTop, 264);
  dom.window.close();
});

test('composer starts compact, grows from measured text, keeps rounded corners, and hides empty-state examples while drafting', () => {
  const app = read('../app.html');
  const ui = read('../js/ui.js');
  const motion = read('../js/ui-welcome-motion.js');
  const css = read('../css/styles.css');
  assert.match(app, /<div class="composer">[\s\S]*?<textarea id="composer-input" rows="1"/);
  assert.doesNotMatch(app, /<div class="composer is-multiline">/);
  assert.match(css, /#composer-input \{[^}]*min-height: 24px; max-height: min\(42vh, 360px\)/);
  assert.match(css, /\.composer\.is-multiline \{[^}]*border-radius: 28px/);
  assert.match(css, /\.welcome-quick-prompts \{ display: none !important; \}/);
  assert.match(ui, /compactContentHeight > compactLineHeight \+ 1/);
  assert.match(ui, /classList\.toggle\('is-multiline', multiline\)/);
  assert.match(ui, /if \(follow\) \{[\s\S]*?composer\.scrollTop = composer\.scrollHeight[\s\S]*?requestAnimationFrame/);
  assert.ok(motion.includes('quickPrompts.hidden = true'));
  assert.ok(motion.includes('quickPrompts.hidden = false'));
});

test('welcome typing is incremental and surrounding motion uses a slower cadence', () => {
  const motion = read('../js/ui-welcome-motion.js');
  const css = read('../css/styles.css');
  assert.match(motion, /const typedText = doc\.createTextNode\(''\);[\s\S]*?typedText\.appendData\(chars\[index\]\)/);
  assert.match(motion, /setTimeout\(revealNext, 64\)/);
  assert.match(css, /welcomeCaret 1s steps\(1, end\) infinite/);
  assert.match(css, /welcomeFade \.58s/);
  assert.match(css, /\.chunk \{ opacity: 0; transition: opacity \.46s ease-out; \}/);
  assert.doesNotMatch(css, /reasoningLineReveal/, '思考区不再使用位移式逐行弹入');
});
