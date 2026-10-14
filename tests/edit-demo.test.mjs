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

test('stable diff DOM, escaped code, per-file selection and no whole-source rendering', () => {
  const n = document.createElement('div'); document.body.append(n);
  const calls = [call({ path: 'a', content: 'keep\n<script>new</script>\n' }), call({ path: 'b', content: 'new b\n' }, 'b')];
  const preview = buildFileEditPreview(calls, disk({ a: 'keep\nold\n', b: '' }));
  const options = { label: 'Edited files 2', paths: ['a', 'b'], discarded: new Set(), preview, live: true };
  paintEditFoldContent(n, options);
  assert.deepEqual([...n.querySelectorAll('.edit-stats')].map((x) => x.textContent), ['+1-1', '+1-0']);
  const firstPath = n.querySelector('.edit-path'); firstPath.click();
  assert.equal(n.querySelector('.ep-path').textContent, 'a');
  assert.equal(n.querySelector('script'), null);
  assert.equal(n.querySelector('.ep-body').textContent.includes('keep'), false);
  const line = n.querySelector('.ep-line'); paintEditFoldContent(n, options);
  assert.equal(n.querySelector('.ep-line'), line); assert.equal(n.querySelector('.edit-path'), firstPath);
  n.remove();
});
test('file activity survives manual collapse and clears on stop/completion', () => {
  const node = document.createElement('div'); node.dataset.ownerId = 'a'; node._userToggle = false;
  const c = call({ path: 'a', content: '' }); node._activeCalls = [c];
  const messages = [{ id: 'u', role: 'user' }, { id: 'a', role: 'assistant', toolCalls: [c] }];
  const context = { messages, visibleMessages: messages, resultIds: new Set(), busy: true };
  syncEditingFold(node, context);
  assert.equal(node.classList.contains('expanded'), false); assert.equal(node.classList.contains('is-working'), true);
  syncEditingFold(node, { ...context, busy: false }); assert.equal(node.classList.contains('is-working'), false);
  syncEditingFold(node, { ...context, resultIds: new Set(['w']) }); assert.equal(node.classList.contains('is-working'), false);
});
test('conversation read fold never renders file content', () => {
  const src = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.equal(src.includes('file-read-stream'), false);
  assert.match(src, /classList.toggle\('is-working', getBusy\(\) && anyRunning/);
});
test('demo clears input before send, streams, folds, offers one final copy, and replays without duplicates', async () => {
  const { mountHomeDemo } = await import('../js/home-demo.js');
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
  const toggle = root.querySelector('.ran-commands .demo-toggle'); toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  await Promise.all([demo.play(), demo.play()]);
  assert.equal(root.querySelectorAll('.msg-user').length, 1);
  assert.equal(root.querySelectorAll('[data-act="copy"]').length, 1);
  demo.destroy(); root.remove();
});
