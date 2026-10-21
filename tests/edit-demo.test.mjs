import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { changedLines } from '../js/editdiff.js';
import { buildFileEditPreview, captureEditPreviewBase, captureEditPreviewSnapshot } from '../js/editpreview.js';
import { paintEditFoldContent, syncEditingFold } from '../js/ui-editpreview.js';

const call = (args, id = 'w') => ({ name: 'write_file', id, args, status: 'running' });
const disk = (files) => ({ read: (p) => { if (!(p in files)) throw new Error('missing'); return files[p]; } });

test('line diff removes unchanged context, preserves signs and original line numbers', () => {
  const d = changedLines('keep\nold\nkeep too\n', 'keep\nnew\nkeep too\n');
  assert.deepEqual([d.added, d.removed], [1, 1]);
  assert.deepEqual(d.changes.map(({ no, text, kind }) => [no, text, kind]), [[2, 'old', 'del'], [2, 'new', 'add']]);
});
test('new/empty/deleted files and CRLF are counted correctly', () => {
  assert.equal(changedLines('', 'a\nb\n').added, 2);
  assert.equal(changedLines('a\nb\n', '').removed, 2);
  assert.equal(changedLines('', '').added, 0);
  assert.equal(changedLines('a\r\nb\r\n', 'a\nb\n').changes.length, 0);
});
test('separated hunks omit all intervening unchanged lines', () => {
  const d = changedLines('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\nE\n');
  assert.deepEqual(d.changes.map((l) => l.hunk), [1, 1, 2, 2]);
  assert.equal(d.changes.some((l) => l.text === 'c'), false);
});
test('overwrite captures pre-write baseline and immutable successful snapshot', () => {
  const files = { 'a.py': 'keep\nold\n' }, f = disk(files), c = call({ path: 'a.py', content: 'keep\nnew\n' });
  captureEditPreviewBase(c, f, { refresh: true });
  files['a.py'] = c.args.content; c.status = 'ok'; captureEditPreviewSnapshot(c, f);
  files['a.py'] = 'a later unrelated write';
  const p = buildFileEditPreview([c], f);
  assert.deepEqual([p.added, p.removed], [1, 1]);
  assert.equal(p.content, 'keep\nnew\n');
  assert.equal(p.fromDisk, true);
  const restored = buildFileEditPreview(JSON.parse(JSON.stringify([c])), f);
  assert.deepEqual(restored.changes, p.changes);
});
test('append and replace show only their changed portions', () => {
  const f = disk({ a: 'keep\nold\n' });
  const append = buildFileEditPreview([call({ path: 'a', mode: 'append', content: 'tail\n' })], f);
  assert.deepEqual([append.added, append.removed], [1, 0]);
  const replace = buildFileEditPreview([call({ path: 'a', mode: 'replace', old_text: 'old', new_text: 'new' })], f);
  assert.deepEqual(replace.changes.map((l) => l.text), ['old', 'new']);
});
test('same-path writes are a net diff and independent files have individual counts', () => {
  const files = { a: 'old\n', b: '' }, f = disk(files);
  const one = call({ path: 'a', content: 'intermediate\n' }, '1');
  captureEditPreviewBase(one, f); files.a = one.args.content; one.status = 'ok'; captureEditPreviewSnapshot(one, f);
  const two = call({ path: 'a', content: 'final\n' }, '2'); captureEditPreviewBase(two, f);
  const three = call({ path: 'b', content: 'new\nlines\n' }, '3');
  const p = buildFileEditPreview([one, two, three], f);
  assert.deepEqual(p.files.map((x) => [x.path, x.added, x.removed]), [['a', 1, 1], ['b', 2, 0]]);
  assert.deepEqual(p.files[0].changes.map((l) => l.text), ['old', 'final']);
});
test('partial JSON supports escaped Unicode; failed writes remain provisional', () => {
  const c = call({ __raw: '{"path":"a","content":"新\\n内' });
  const p = buildFileEditPreview([c], disk({ a: '旧\n' }));
  assert.equal(p.complete, false); assert.equal(p.added, 2); assert.equal(p.removed, 1);
  c.status = 'error';
  assert.equal(buildFileEditPreview([c], disk({ a: '旧\n' })).files[0].failed, true);
});
test('legacy sessions without a baseline do not fabricate +all statistics', () => {
  const c = call({ path: 'a', content: 'whole file' }); c.status = 'ok';
  const p = buildFileEditPreview([c], disk({ a: 'whole file' }));
  assert.equal(p.added, null); assert.equal(p.diffUnavailable, true); assert.deepEqual(p.changes, []);
});

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, matchMedia: () => ({ matches: true }) });
Object.defineProperty(document, 'hidden', { value: false });

test('stable per-file diff DOM: all edited files stay visible, code is escaped, unchanged source is omitted', () => {
  const n = document.createElement('div'); document.body.append(n);
  const additions = ['<script>new</script>', ...Array.from({ length: 9 }, (_, i) => `added-${i + 1}`)].join('\n') + '\n';
  const calls = [call({ path: 'example/abc.txt', content: additions }), call({ path: 'example/def.txt', content: '' }, 'b')];
  const deletions = Array.from({ length: 10 }, (_, i) => `old-${i + 1}`).join('\n') + '\n';
  const preview = buildFileEditPreview(calls, disk({ 'example/abc.txt': '', 'example/def.txt': deletions }));
  const options = { label: 'Edited Files 2', paths: ['example/abc.txt', 'example/def.txt'], discarded: new Set(), preview, live: true };
  paintEditFoldContent(n, options);
  assert.equal(n.querySelector('.chip-name').textContent, 'Edited Files 2');
  const stats = [...n.querySelectorAll('.edit-stats')];
  assert.deepEqual(stats.map((row) => [...row.children].map((item) => item.textContent)), [['+10', '-0'], ['-10', '0']]);
  assert.deepEqual([...stats[1].children].map((item) => item.className), ['diff-del', 'diff-add']);
  assert.deepEqual([...n.querySelectorAll('.ep-path')].map((x) => x.textContent), ['example/abc.txt', 'example/def.txt']);
  assert.equal(n.querySelectorAll('.edit-preview').length, 2, '多个文件的差异卡应同时显示');
  const firstPath = n.querySelector('.edit-path');
  const firstRow = firstPath.closest('.edit-path-row');
  assert.ok(firstRow.querySelector('.edit-path-fold .edit-preview'), '文件编辑窗口嵌在各自文件名下的二级折叠里');
  assert.equal(firstPath.getAttribute('aria-expanded'), 'true', '流式写入时默认展开文件预览');
  firstPath.click();
  assert.equal(firstPath.getAttribute('aria-expanded'), 'false', '点击文件名收起对应预览');
  assert.deepEqual([...n.querySelectorAll('.ep-path')].map((x) => x.textContent), ['example/abc.txt', 'example/def.txt']);
  assert.equal(n.querySelector('script'), null);
  assert.equal(n.querySelector('.edit-preview[data-path="example/abc.txt"] .ep-body').textContent.includes('old-1'), false, '仅展示修改行，不混入磁盘上的旧内容');
  const firstCard = n.querySelector('.edit-preview[data-path="example/abc.txt"]');
  const line = firstCard.querySelector('.ep-line'); paintEditFoldContent(n, options);
  assert.equal(n.querySelector('.edit-preview[data-path="example/abc.txt"] .ep-line'), line, '流式刷新复用既有行节点');
  assert.equal(n.querySelector('.edit-path'), firstPath, '路径列表也保持稳定');
  assert.equal(n.querySelectorAll('.edit-preview').length, 2);
  n.remove();
});
test('nested per-file editor folds open while streaming, auto-collapse at completion, and remain user-toggleable', () => {
  const node = document.createElement('div'); document.body.append(node);
  const newline = String.fromCharCode(10);
  const c = call({ path: 'a.py', content: `new${newline}` });
  const preview = buildFileEditPreview([c], disk({ 'a.py': `old${newline}` }));
  const options = { label: 'Writing file', paths: ['a.py'], discarded: new Set(), preview, live: true };
  paintEditFoldContent(node, options);
  const button = node.querySelector('.edit-path'), row = button.closest('.edit-path-row');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(row.querySelector('.edit-preview')?.dataset.path, 'a.py');
  paintEditFoldContent(node, { ...options, label: 'Edited File', live: false });
  assert.equal(button.getAttribute('aria-expanded'), 'false', '流式结束时二级折叠自动关闭');
  button.click();
  assert.equal(button.getAttribute('aria-expanded'), 'true', '结束后仍可手动展开');
  paintEditFoldContent(node, { ...options, label: 'Edited File', live: false });
  assert.equal(button.getAttribute('aria-expanded'), 'true', '非流式重绘保留手动状态');
  node.remove();
});

test('file activity survives a chosen state; completed edit folds automatically once', () => {
  const node = document.createElement('div'); node.className = 'edited-files'; node.dataset.ownerId = 'a'; node._userToggle = null;
  const c = call({ path: 'a', content: '' }); node._activeCalls = [c];
  const messages = [{ id: 'u', role: 'user' }, { id: 'a', role: 'assistant', toolCalls: [c] }];
  const context = { messages, visibleMessages: messages, resultIds: new Set(), busy: true };
  syncEditingFold(node, context);
  assert.equal(node.classList.contains('expanded'), true, '写入开始时默认展开');
  assert.equal(node.classList.contains('is-working'), true);
  node._userToggle = true;
  c.status = 'ok';
  assert.equal(syncEditingFold(node, { ...context, busy: false, resultIds: new Set(['w']) }), true, '结算沿用自动收起路径');
  assert.equal(node.classList.contains('expanded'), false);
  assert.equal(node._userToggle, false);
  syncEditingFold(node, { ...context, busy: false, resultIds: new Set(['w']) });
  assert.equal(node.classList.contains('expanded'), false, '后续重绘不再重新展开');
  node._userToggle = true;
  syncEditingFold(node, { ...context, busy: false, resultIds: new Set(['w']) });
  assert.equal(node.classList.contains('expanded'), true, '完成后用户仍可手动展开');
});
test('non-edit file folds retain their prior active/manual toggle behavior', () => {
  const node = document.createElement('div'); node.dataset.ownerId = 'a'; node._userToggle = false;
  const c = call({ path: 'a', content: '' }); node._activeCalls = [c];
  const messages = [{ id: 'u', role: 'user' }, { id: 'a', role: 'assistant', toolCalls: [c] }];
  const context = { messages, visibleMessages: messages, resultIds: new Set(), busy: true };
  syncEditingFold(node, context);
  assert.equal(node.classList.contains('expanded'), false); assert.equal(node.classList.contains('is-working'), true);
  syncEditingFold(node, { ...context, busy: false }); assert.equal(node.classList.contains('is-working'), false);
});
test('conversation read fold never renders file content', () => {
  const src = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.equal(src.includes('file-read-stream'), false);
  assert.match(src, /classList.toggle\('is-working', getBusy\(\) && anyRunning/);
});
test('demo clears input before send, streams, folds, offers one final copy, and replays without duplicates', async () => {
  const { mountHomeDemo } = await import('../js/home-demo.js');
  const { setLanguagePreference } = await import('../js/locale.js');
  setLanguagePreference('zh'); // jsdom 的 navigator 是 en-US；显式钉住中文，断言的中文文案才有意义
  const html = fs.readFileSync(new URL('../demo/chat-card.html', import.meta.url), 'utf8');
  const root = document.createElement('div'); root.innerHTML = new JSDOM(html).window.document.querySelector('.card-root').innerHTML;
  document.body.append(root);
  let checkedSend = false, checkedAgent = false;
  const demo = mountHomeDemo(root, { autoStart: false, delay: async () => {
    if (root.dataset.phase === 'sending') { assert.equal(root.querySelector('textarea').value, ''); checkedSend = true; }
    if (root.dataset.phase === 'agent') { assert.equal(root.querySelectorAll('[data-act="copy"]').length, 0); checkedAgent = true; }
  } });
  await demo.play();
  assert.equal(root.dataset.phase, 'complete'); assert.ok(checkedSend && checkedAgent);
  assert.equal(root.querySelectorAll('[data-act="copy"]').length, 1);
  assert.equal(root.querySelectorAll('.is-working').length, 0);
  assert.equal(root.querySelectorAll('.explored-files pre').length, 0);
  assert.equal(root.querySelectorAll('.edit-stats').length, 3);
  assert.equal(root.querySelectorAll('.expanded').length, 0);
  assert.equal(root.querySelectorAll('.msg-actions button').length, 6);
  assert.ok([...root.querySelectorAll('.msg-actions button')].every((b) => b.querySelector('svg') && !b.textContent.trim()));
  assert.equal(root.querySelector('.msg-foot').textContent, '命令总耗时 3.8s · 模拟');
  const toggle = root.querySelector('.ran-commands .demo-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true'); toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  await Promise.all([demo.play(), demo.play()]);
  assert.equal(root.querySelectorAll('.msg-user').length, 1);
  assert.equal(root.querySelectorAll('[data-act="copy"]').length, 1);
  demo.destroy(); root.remove();
});

// 演示跟随界面语言：英文界面下整段演示（提示词、旁白、状态栏、外壳文字）都用英文播放。
test('demo plays in English when the UI language is English', async () => {
  const { mountHomeDemo } = await import('../js/home-demo.js');
  const { setLanguagePreference } = await import('../js/locale.js');
  setLanguagePreference('en');
  const html = fs.readFileSync(new URL('../demo/chat-card.html', import.meta.url), 'utf8');
  const root = document.createElement('div'); root.innerHTML = new JSDOM(html).window.document.querySelector('.card-root').innerHTML;
  document.body.append(root);
  let demo;
  try {
    demo = mountHomeDemo(root, { autoStart: false, delay: async () => {} });
    // 挂载即同步外壳文字，不必等播放开始
    assert.equal(root.querySelector('#demo-replay').textContent, '↻ Replay');
    assert.equal(root.querySelector('#composer-input').placeholder, 'You bring the idea, Dubhe builds it');
    assert.equal(root.querySelector('.composer-hint').textContent, 'Simulated run; no model calls and no real tool execution');
    assert.equal(root.querySelector('#messages').getAttribute('aria-label'), 'Agent demo conversation');
    await demo.play();
    assert.equal(root.dataset.phase, 'complete');
    assert.equal(root.querySelector('.msg-user').textContent, 'Update the timezone conversion in date_utils.py to support Asia/Shanghai, handle DST and naive inputs, add unit tests, then run lint');
    assert.ok(root.querySelector('.msg-foot').textContent.includes('Command time 3.8s · simulated'));
    assert.equal(root.querySelector('#demo-status').textContent, 'Agent demo · complete');
    assert.equal(document.documentElement.lang, 'en');
  } finally { demo?.destroy(); root.remove(); setLanguagePreference('zh'); }
});

// 切换语言后：已播放的演示自动清空，按切换后的语言重播（用户要求的行为）。
test('demo clears and replays in the newly selected language on language switch', async () => {
  const { mountHomeDemo } = await import('../js/home-demo.js');
  const { setLanguagePreference } = await import('../js/locale.js');
  setLanguagePreference('zh');
  const html = fs.readFileSync(new URL('../demo/chat-card.html', import.meta.url), 'utf8');
  const root = document.createElement('div'); root.innerHTML = new JSDOM(html).window.document.querySelector('.card-root').innerHTML;
  document.body.append(root);
  let demo;
  try {
    demo = mountHomeDemo(root, { autoStart: false, delay: async () => {} });
    await demo.play();
    assert.ok(root.querySelector('.msg-user').textContent.includes('date_utils.py'));
    assert.ok(root.querySelector('.msg-user').textContent.includes('时区转换'));
    const settle = async () => { while (root.dataset.phase !== 'complete') await new Promise((r) => setTimeout(r, 5)); };
    setLanguagePreference('en'); // 同文档场景走 onLanguageChange；真实 iframe 场景走 storage 事件，回调一致
    await settle();
    assert.equal(root.querySelectorAll('.msg-user').length, 1, '重播前必须清空，不能中英两轮并存');
    assert.ok(root.querySelector('.msg-user').textContent.includes('timezone conversion'));
    assert.ok(root.querySelector('.msg-foot').textContent.includes('Command time 3.8s · simulated'));
    assert.equal(root.querySelector('#demo-replay').textContent, '↻ Replay');
    assert.equal(document.documentElement.lang, 'en');
    setLanguagePreference('zh');
    await settle();
    assert.equal(root.querySelectorAll('.msg-user').length, 1);
    assert.ok(root.querySelector('.msg-user').textContent.includes('时区转换'));
  } finally { demo?.destroy(); root.remove(); setLanguagePreference('zh'); }
});
