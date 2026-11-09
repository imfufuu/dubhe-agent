// 项目模式 BUG 回归：删除当前选中预览的主目录后，旧文件内容不得滞留在背景层。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { resetPreviewSurface, isActiveUnderPath } from '../js/project-preview-cleanup.js';

test('isActiveUnderPath 覆盖目录本身、子文件、兄弟目录与空路径', () => {
  assert.equal(isActiveUnderPath('src/main.js', 'src'), true);
  assert.equal(isActiveUnderPath('src', 'src'), true);
  assert.equal(isActiveUnderPath('src/lib/a.js', 'src'), true);
  assert.equal(isActiveUnderPath('src2/a.js', 'src'), false);
  assert.equal(isActiveUnderPath('', 'src'), false);
  assert.equal(isActiveUnderPath('src/main.js', ''), false);
  assert.equal(isActiveUnderPath('src/main.js', 'src/'), true);
});

test('resetPreviewSurface 清空高亮层、行号、标记、媒体 DOM 与编辑器', () => {
  const dom = new JSDOM(`<body><div class="pm-code hl-on"><pre class="pm-hl"><code class="hljs">const x = 1;</code></pre><textarea class="pm-text">old</textarea></div><div class="pm-gutter">1
2</div><div class="pm-marks"><i></i></div><div class="pm-media"><img src="data:image/png;base64,AAAA"></div><div class="pm-empty" hidden></div></body>`);
  const d = dom.window.document;
  const els = {
    textarea: d.querySelector('.pm-text'), gutter: d.querySelector('.pm-gutter'),
    hlCode: d.querySelector('.hljs'), hlPre: d.querySelector('.pm-hl'),
    codeWrap: d.querySelector('.pm-code'), marks: d.querySelector('.pm-marks'),
    mediaView: d.querySelector('.pm-media'), emptyNote: d.querySelector('.pm-empty'),
  };
  els.mediaView._path = 'a.png'; els.mediaView._value = 'data:image/png;base64,AAAA';
  resetPreviewSurface(els);
  assert.equal(els.hlCode.innerHTML, '');
  assert.equal(els.codeWrap.classList.contains('hl-on'), false);
  assert.equal(els.gutter.textContent, '');
  assert.equal(els.marks.children.length, 0);
  assert.equal(els.textarea.value, '');
  assert.equal(els.textarea.hidden, true);
  assert.equal(els.mediaView.children.length, 0);
  assert.equal(els.mediaView.hidden, true);
  assert.equal(els.mediaView._path, '');
  assert.equal(els.emptyNote.hidden, false);
  dom.window.close();
});

test('集成：打开 JS 文件 → 选中主目录 → 删除，预览区所有残留被清空', async () => {
  const { openProjectMode } = await import('../js/project-mode.js');
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.getComputedStyle = dom.window.getComputedStyle;
  dom.window.confirm = () => true;
  const store = { state: { project: { files: {
    'src/main.js': 'const answer = 42;\nconsole.log(answer);\n',
    'src/notes.md': 'hello\n',
  } } } };
  let instance;
  try {
    instance = openProjectMode({ store, agent: {} });
    const hl = document.querySelector('.pm-code code.hljs');
    assert.ok(hl && hl.innerHTML.length > 0, '打开 .js 文件后底层高亮层必须有内容（BUG 复现前提）');
    const dirRow = [...document.querySelectorAll('.pm-tree-row')].find((el) => el.dataset.path === 'src');
    assert.ok(dirRow, '应存在 src 目录行');
    dirRow.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    dirRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true }));
    const del = document.querySelector('[data-action="delete"]');
    assert.ok(del, '右键菜单应有删除动作');
    del.click();
    await Promise.resolve();
    // 背景层不再有旧代码
    assert.equal(document.querySelector('.pm-code code.hljs').innerHTML, '', '语法高亮层必须清空');
    assert.equal(document.querySelector('.pm-code').classList.contains('hl-on'), false, 'hl-on 必须移除');
    assert.equal(document.querySelector('.pm-gutter').textContent, '');
    assert.equal(document.querySelector('.pm-marks').children.length, 0);
    assert.equal(document.querySelector('.pm-text').hidden, true);
    assert.equal(document.querySelector('.pm-text').value, '');
    assert.equal(document.querySelector('.pm-media').children.length, 0);
    assert.equal(document.querySelector('.pm-media').hidden, true);
    assert.equal(document.querySelector('.pm-empty').hidden, false);
    assert.equal(document.querySelectorAll('.pm-tab').length, 0, '被删文件的标签必须关闭');
    assert.equal(Object.keys(store.state.project.files).some((p) => p.startsWith('src/')), false);
  } finally {
    if (instance) await instance.close();
    dom.window.close();
    Object.assign(globalThis, previous);
  }
});

test('接线：showEmpty 与 removePath 都使用集中清理函数', () => {
  const src = fs.readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  assert.match(src, /resetPreviewSurface\(\{ textarea, gutter, hlCode, hlPre, codeWrap, marks, mediaView, emptyNote \}\)/);
  assert.match(src, /isActiveUnderPath\(state\.active, path\)/);
  assert.match(src, /from '\.\/project-preview-cleanup\.js'/);
});
