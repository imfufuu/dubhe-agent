// 第 17 条（段 1）：项目模式的纯逻辑与接线检查——路径、语言、编辑器缩进/回车、资源管理器树、Agent 写回沙箱。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isWorkspacePath, workspaceEntries, isBinaryContent, languageOf, lineCol, lineCount,
  indentEdit, enterEdit, validateName, joinPath, parentDir, explorerRows,
} from '../js/project-core.js';
import { createAgent } from '../js/agent.js';

test('workspace paths reject traversal, absolute paths and internal folders', () => {
  assert.equal(isWorkspacePath('src/app.js'), true);
  assert.equal(isWorkspacePath('../x'), false);
  assert.equal(isWorkspacePath('a/../b'), false);
  assert.equal(isWorkspacePath('/etc/x'), false);
  assert.equal(isWorkspacePath('a\\b'), false);
  assert.equal(isWorkspacePath('internal/state.json'), false);
  assert.equal(isWorkspacePath('.git/config'), false);
  assert.equal(isWorkspacePath(''), false);
});

test('workspaceEntries lists only workspace files, sorted', () => {
  const entries = workspaceEntries({ 'b.md': 'x', 'internal/k': 'y', 'a/z.py': 'zz', '../bad': 'q' });
  assert.deepEqual(entries.map((e) => e.path), ['a/z.py', 'b.md']);
  assert.equal(entries[0].size, 2);
});

test('binary detection and language mapping', () => {
  assert.equal(isBinaryContent('data:image/png;base64,AAAA'), true);
  assert.equal(isBinaryContent('ab\0cd'), true);
  assert.equal(isBinaryContent('plain text'), false);
  assert.equal(languageOf('src/Main.PY'), 'Python');
  assert.equal(languageOf('x.cpp'), 'C++');
  assert.equal(languageOf('Makefile'), 'Makefile');
  assert.equal(languageOf('noext'), 'Text');
  assert.equal(languageOf('.env'), 'Text');
});

test('line and column are 1-based and count lines correctly', () => {
  assert.deepEqual(lineCol('ab\ncd', 0), { line: 1, col: 1 });
  assert.deepEqual(lineCol('ab\ncd', 4), { line: 2, col: 2 });
  assert.deepEqual(lineCol('ab\ncd', 99), { line: 2, col: 3 });
  assert.equal(lineCount(''), 1);
  assert.equal(lineCount('a\nb\n'), 3);
});

test('Tab with no selection inserts one indent unit at the caret', () => {
  const r = indentEdit('abc', 1, 1);
  assert.deepEqual(r, { value: 'a  bc', start: 3, end: 3 });
});

test('Tab over a selection indents whole lines and keeps the selection covering them', () => {
  const r = indentEdit('a\nb', 0, 3);
  assert.equal(r.value, '  a\n  b');
  assert.equal(r.start, 2);
  assert.equal(r.end, 7);
});

test('Shift+Tab removes at most one indent unit per line', () => {
  const r = indentEdit('    a\n b', 0, 6, { dedent: true });
  assert.equal(r.value, '  a\nb');
  const tab = indentEdit('\tx', 0, 0, { dedent: true });
  assert.equal(tab.value, 'x');
});

test('Enter keeps the current indentation and adds one level after an opener', () => {
  assert.equal(enterEdit('  foo', 5, 5).value, '  foo\n  ');
  const opened = enterEdit('if (x) {', 8, 8);
  assert.equal(opened.value, 'if (x) {\n  ');
  assert.equal(opened.start, opened.value.length);
  assert.equal(enterEdit('def f():', 8, 8).value, 'def f():\n  ');
});

test('names are validated; joinPath and parentDir work for nested paths', () => {
  assert.equal(validateName('  ok.js ').name, 'ok.js');
  assert.equal(validateName('').ok, false);
  assert.equal(validateName('..').ok, false);
  assert.equal(validateName('a/b').ok, false);
  assert.equal(joinPath('', 'a.js'), 'a.js');
  assert.equal(joinPath('src', 'a.js'), 'src/a.js');
  assert.equal(parentDir('src/lib/a.js'), 'src/lib');
  assert.equal(parentDir('a.js'), '');
});

test('explorer rows put directories first and respect collapsed folders', () => {
  const files = [{ path: 'src/a.js', size: 1 }, { path: 'src/lib/b.js', size: 1 }, { path: 'README.md', size: 1 }];
  const open = explorerRows(files, new Set()).map((r) => r.path);
  assert.deepEqual(open, ['src', 'src/lib', 'src/lib/b.js', 'src/a.js', 'README.md']);
  const closed = explorerRows(files, new Set(['src'])).map((r) => r.path);
  assert.deepEqual(closed, ['src', 'README.md']);
});

test('agent exposes sandboxWrite / sandboxRemove that write the persistent workspace and sync the store', () => {
  const state = { files: {} };
  let notified = 0;
  const store = {
    state,
    notify() { notified++; },
    save() {},
    get messages() { return []; },
  };
  const agent = createAgent(store, {});
  assert.equal(typeof agent.sandboxWrite, 'function');
  assert.equal(typeof agent.sandboxRemove, 'function');
  agent.sandboxWrite('src/hello.py', 'print(1)\n');
  assert.equal(store.state.files['src/hello.py'], 'print(1)\n');
  assert.ok(notified >= 1);
  agent.sandboxRemove('src/hello.py');
  assert.equal('src/hello.py' in store.state.files, false);
  assert.throws(() => agent.sandboxWrite('../evil', 'x'), /非法路径/);
});

test('project mode is wired: entry button, main.js install call, and CSS', () => {
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(html, /id="open-project"/);
  assert.match(html, /id="project-toggle"/);
  assert.match(main, /installProjectEntry\(\{ store, agent \}\)/);
  assert.match(css, /\.pm-root \{/);
});

test('regression: the 900ms poll must not rebuild the tree while a name is being edited', () => {
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  // renderTree 必须有 force 开关，且在编辑中或树未变化时跳过重建（否则输入框会被销毁、焦点丢失）。
  assert.match(src, /function renderTree\(\s*\{\s*force\s*(?:=\s*false\s*)?\}/);
  assert.match(src, /state\.creating|state\.renaming|editing/);
});

test('IME: Enter during composition does not commit create/rename', () => {
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  const guards = src.match(/e\.isComposing \|\| e\.keyCode === 229/g) || [];
  assert.ok(guards.length >= 2, `expected IME guards on create and rename, found ${guards.length}`);
});

test('项目窗口顶栏没有 AI 按钮与侧边面板：项目内的修改统一经对话区进行', () => {
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /btnAi|pm-ai|setAiOpen|renderAi|sendAi/);
});

test('运行按钮：仅对可运行脚本显示，且 hidden 不被 .pm-btn 的 display 覆盖', () => {
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(src, /btnRun\.hidden = !\(tab && runnerFor\(tab\.path\)\)/);
  assert.match(css, /\.pm-btn\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('项目编辑器语法高亮：经 highlightCode 着色，textarea 文字透明，滚动同步', () => {
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(src, /import \{ highlightCode \} from '\.\/ui-markdown\.js\?v=2026\.10\.25\.1'/);
  assert.match(src, /highlightCode\(textarea\.value \+ '\\n', lang, escHtml\)/);
  assert.match(src, /hlPre\.scrollTop = textarea\.scrollTop/);
  assert.match(css, /\.pm-code\.hl-on > \.pm-text \{ color: transparent/);
});

test('project window: import files/folders wired, binary and duplicate files are skipped, buttons are taller with icons', () => {
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  assert.match(src, /webkitdirectory: true/);
  assert.match(src, /async function importFiles\(input, \{ folder = false \} = \{\}\)/);
  assert.match(src, /head\.includes\(0\)/); // 二进制按 NUL 字节判断，存为 data URL 导入
  assert.match(src, /taken\.has\(path\)/);
  assert.match(src, /svgIcon\(ICON\.save\)/);
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.pm-btn \{\n  display: inline-flex; align-items: center; gap: 6px; height: 36px;/);
});

test('workspace transfers reject collisions and descendant moves, and name same-folder copies safely', async () => {
  const { planWorkspaceTransfer } = await import('../js/project-core.js');
  const snap = { 'src/a.txt': 'a', 'src/sub/.keep': '', 'other/.keep': '', 'other/a.txt': 'existing' };
  assert.equal(planWorkspaceTransfer(snap, 'src', 'src/sub').ok, false);
  assert.equal(planWorkspaceTransfer(snap, 'src/a.txt', 'other').ok, false);
  assert.equal(planWorkspaceTransfer(snap, 'src/a.txt', 'src', { copy: true }).target, 'src/a copy.txt');
  assert.equal(planWorkspaceTransfer(snap, 'src', '', { copy: true }).target, 'src copy');
  assert.equal(planWorkspaceTransfer(snap, 'src/a.txt', 'missing').ok, false);
  assert.equal(planWorkspaceTransfer(snap, '../secret', 'other').ok, false);
});

test('strict ZIP extraction preserves binary and rejects unsafe or corrupt archives before writing', async () => {
  const { createZip } = await import('../js/zip.js');
  const { unpackZip } = await import('../js/unzip.js');
  const data = new Uint8Array([0xff, 0xfe, 0xfd, 0x41]);
  const good = new Uint8Array(await createZip([{ name: 'oddfile', bytes: data }]).arrayBuffer());
  const result = await unpackZip(good, { strict: true });
  assert.equal(result.ok, true);
  assert.equal(result.files[0].content, 'data:application/octet-stream;base64,//79QQ==');
  const unsafe = new Uint8Array(await createZip([{ name: 'ok.txt', bytes: data }, { name: '../evil', bytes: data }]).arrayBuffer());
  assert.equal((await unpackZip(unsafe, { strict: true })).ok, false);
  const corrupt = good.slice(); corrupt[30 + 'oddfile'.length] ^= 1;
  assert.match((await unpackZip(corrupt, { strict: true })).error, /校验失败/);
});

test('project ZIP uses native DEFLATE when available and remains readable', async () => {
  const { createCompressedZip } = await import('../js/zip.js');
  const { unpackZip } = await import('../js/unzip.js');
  const content = 'repeatable data '.repeat(2000);
  const bytes = new Uint8Array(await (await createCompressedZip([{ name: 'file.txt', bytes: new TextEncoder().encode(content) }])).arrayBuffer());
  if (typeof CompressionStream === 'function') assert.ok(bytes.length < content.length / 2);
  const out = await unpackZip(bytes, { strict: true });
  assert.equal(out.ok, true, out.error); assert.equal(out.files[0].content, content);
});

test('ZIP creation falls back to STORE when raw DEFLATE is unavailable', async () => {
  const { createCompressedZip } = await import('../js/zip.js');
  const { unpackZip } = await import('../js/unzip.js');
  const saved = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const zip = await createCompressedZip([{ name: 'x.txt', bytes: new TextEncoder().encode('hello') }]);
    const result = await unpackZip(new Uint8Array(await zip.arrayBuffer()), { strict: true });
    assert.equal(result.ok, true); assert.equal(result.files[0].content, 'hello');
  } finally { globalThis.CompressionStream = saved; }
});

test('strict ZIP extraction preserves empty directories with internal placeholders', async () => {
  const { createZip } = await import('../js/zip.js');
  const { unpackZip } = await import('../js/unzip.js');
  const archive = createZip([{ name: 'parent/', bytes: new Uint8Array() }, { name: 'parent/empty/', bytes: new Uint8Array() }]);
  const result = await unpackZip(new Uint8Array(await archive.arrayBuffer()), { strict: true });
  assert.equal(result.ok, true); assert.deepEqual(result.files.map(f => f.path), ['parent/empty/.keep']);
});
