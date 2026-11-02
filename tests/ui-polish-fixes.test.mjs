// 第 1 / 3 / 4 / 5 项的接线检查：顶栏项目入口、模型菜单米白、C++ 进度条、全站关闭点击灰底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the project entry is in the top bar and is bound', () => {
  const html = read('app.html');
  assert.match(html, /<button id="project-toggle"[^>]*class="pill"/);
  const mode = read('js/project-mode.js');
  assert.match(mode, /\['project-toggle', 'open-project'\]/);
});

test('model menu uses the warm off-white conversation card colour (matches model cards)', () => {
  const css = read('css/styles.css');
  const menu = css.match(/\.dd-menu \{[^}]*\}/)?.[0] || '';
  assert.match(menu, /background: var\(--model-menu-bg\)/);
  assert.match(css, /\.dd-search-wrap \{[^}]*background: var\(--model-menu-bg\)/);
});

test('C++ progress: the project window forwards phases and download bytes to a progress bar', () => {
  const mode = read('js/project-mode.js');
  assert.match(mode, /runCpp\(code, \{[\s\S]*onPhase:[\s\S]*onProgress:/);
  assert.match(mode, /class: 'pm-progress'/);
  assert.match(read('css/styles.css'), /\.pm-progress\.indeterminate \.pm-prog-fill/);
});

test('local C++ worker reads the pinned .gz toolchain and decompresses it', () => {
  const worker = read('js/worker-cpp.js');
  assert.match(worker, /\$\{name\}\.gz/);
  assert.match(worker, /DecompressionStream\('gzip'\)/);
});

test('copy paths use the shared copyText helper (no bare navigator.clipboard calls in UI code)', () => {
  for (const file of ['js/ui.js', 'js/ui-files-panel.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /navigator\.clipboard\.writeText\(/, file);
    assert.match(src, /import \{ copyText \} from '\.\/copy-text\.js'/, file);
  }
});

test('every interactive control has a transparent tap highlight (no grey flash on press)', () => {
  const fx = read('css/page-fx.css');
  assert.match(fx, /\*, \*::before, \*::after \{ -webkit-tap-highlight-color: transparent; \}/);
});
