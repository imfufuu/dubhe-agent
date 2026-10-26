import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { paintEditFoldContent } from '../js/ui-editpreview.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('local model picker uses a gray LOCAL badge with an inline SVG and no readiness label', () => {
  const picker = read('../js/ui-model-picker.js');
  const css = read('../css/styles.css');
  assert.match(picker, /class="badge local-model-badge"[^>]*><svg viewBox="0 0 16 16"[\s\S]*?<span>LOCAL<\/span>/);
  assert.doesNotMatch(picker, /localState|已就绪|Not selected|Checking/);
  assert.match(css, /\.badge\.local-model-badge \{[^}]*color: var\(--fg-3\); border-color: var\(--line-2\)/);
  assert.match(css, /\.badge\.local-model-badge svg \{[^}]*width: 11px/);
});

test('salutation input matches standard setting width and shows only a local-review check or cross', () => {
  const settings = read('../js/settings.js');
  const css = read('../css/styles.css');
  const app = read('../app.html');
  assert.match(settings, /status\.textContent = result\.ok \? '✓' : '✗';/);
  assert.match(settings, /salutationCheckTimer = setInterval\(refreshSalutation, 1000\)/);
  assert.match(app, /id="set-user-salutation" class="set-input/);
  assert.match(css, /\.user-salutation-control \.set-input \{ flex: 0 1 230px; width: 230px;/);
  assert.doesNotMatch(css, /\.user-salutation-control \.set-input \{[^}]*126px/);
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
  assert.match(localDetails, /<button class="offline-model-summary"[^>]*aria-expanded="false"[^>]*aria-controls="offline-model-detail-panel"/);
  assert.match(localDetails, /<div class="offline-model-detail-panel"[^>]*aria-hidden="true" inert/);
  assert.match(settings, /offlineDetailsToggle\.addEventListener\('click'/);
  assert.match(settings, /offlineDetailsPanel\.inert = !expanded/);
  assert.match(css, /\.offline-model-summary \{[\s\S]*?width: 100%;[\s\S]*?text-align: left/s);
  assert.match(css, /\.offline-model-details\[aria-expanded="true"\] \.offline-model-detail-panel \{ grid-template-rows: 1fr; opacity: 1/);
  assert.match(css, /transition: grid-template-rows \.34s var\(--ease\), opacity \.24s/);
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

test('welcome typing is incremental and surrounding motion uses a slower cadence', () => {
  const motion = read('../js/ui-welcome-motion.js');
  const css = read('../css/styles.css');
  assert.match(motion, /const typedText = doc\.createTextNode\(''\);[\s\S]*?typedText\.appendData\(chars\[index\]\)/);
  assert.match(motion, /setTimeout\(revealNext, 64\)/);
  assert.match(css, /welcomeCaret 1s steps\(1, end\) infinite/);
  assert.match(css, /welcomeFade \.58s/);
  assert.match(css, /\.chunk \{ opacity: 0; transition: opacity \.46s ease-out; \}/);
  assert.match(css, /\.reasoning \.reasoning-line-entering\.is-visible \{ animation: reasoningLineReveal \.46s/);
});
