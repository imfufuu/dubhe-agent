import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createStore, extractBlobs, applyBlobs, createBlobPersistenceQueue } from '../js/state.js';
import { createProjectFS, isProjectUserPath } from '../js/project-store.js';
import { createFS } from '../js/sandbox.js';
import { executeTool } from '../js/tools.js';
import { reviewProjectImport } from '../js/project-import-review.js';
import { projectIconType, projectIconSvg } from '../js/project-icons.js';

test('project survives conversation switches and reload without importing sandbox files', () => {
  const dom = new JSDOM('', { url: 'https://example.test' });
  const previous = globalThis.localStorage; globalThis.localStorage = dom.window.localStorage;
  try {
    const store = createStore(), first = store.state.activeSessionId, project = createProjectFS(store);
    store.state.files['sandbox.txt'] = 'sandbox'; project.write('src/a.txt', 'project');
    const other = store.createSession();
    assert.notEqual(other.id, first); assert.deepEqual(store.state.files, {});
    assert.equal(project.read('src/a.txt'), 'project');
    store.state.files['new.txt'] = 'new'; store.switchSession(first);
    assert.equal(store.state.files['sandbox.txt'], 'sandbox');
    assert.equal(project.has('sandbox.txt'), false); assert.equal(project.has('new.txt'), false);
    store.save(true);
    const reloaded = createStore();
    assert.equal(createProjectFS(reloaded).read('src/a.txt'), 'project');
    assert.equal(reloaded.state.files['sandbox.txt'], 'sandbox');
  } finally { globalThis.localStorage = previous; dom.window.close(); }
});

test('project blob versions do not alias and missing blobs block mutations until hydration', () => {
  const store = { state: {}, notify() {} }, p = createProjectFS(store);
  p.write('large.txt', 'a'.repeat(17000));
  const first = extractBlobs(store.state), key = first.light.project.blobFiles['large.txt'];
  p.write('large.txt', 'b'.repeat(17000));
  const second = extractBlobs(store.state), key2 = second.light.project.blobFiles['large.txt'];
  assert.notEqual(key, key2);
  const restored = { state: { project: second.light.project }, notify() {} }, fs = createProjectFS(restored);
  assert.throws(() => fs.write('other', 'x'), /恢复|存储/);
  assert.throws(() => fs.export(), /恢复|存储/);
  assert.equal(applyBlobs(restored.state, new Map(second.blobs)), 1);
  assert.equal(fs.read('large.txt'), 'b'.repeat(17000)); fs.write('other', 'ok');
});

test('blob queue publishes index only after successful put and before prune', async () => {
  const events = [], queue = createBlobPersistenceQueue({ put: async () => { events.push('put'); }, prune: async () => { events.push('prune'); } });
  await queue([['k', 'v']], ['k'], () => { events.push('commit'); });
  assert.deepEqual(events, ['put', 'commit', 'prune']);
  const failed = createBlobPersistenceQueue({ put: async () => { throw Error('quota'); }, prune: async () => events.push('bad-prune') });
  await assert.rejects(failed([['k', 'v']], ['k'], () => events.push('bad-commit')));
  assert.deepEqual(events, ['put', 'commit', 'prune']);
});

test('scoped tools copy only explicitly named files and prevent Git metadata access', async () => {
  const store = { state: {}, notify() {} }, p = createProjectFS(store), fs = createFS({ 'uploads/a.txt': 'copied', 'uploads/b.txt': 'secret' });
  const ctx = { fs, projectFs: p, sandboxEnabled: true };
  assert.match(await executeTool('write_file', { scope: 'project', path: 'src/a.txt', source_path: 'uploads/a.txt' }, ctx), /已写入/);
  assert.equal(p.read('src/a.txt'), 'copied'); assert.equal(p.has('uploads/b.txt'), false);
  assert.match(await executeTool('write_file', { path: 'local.txt', content: 'local' }, ctx), /已写入/);
  assert.equal(p.has('local.txt'), false); assert.equal(fs.read('local.txt'), 'local');
  assert.match(await executeTool('write_file', { scope: 'project', path: '.git/dubhe.json', content: '{}' }, ctx), /受保护/);
  assert.match(await executeTool('read_file', { scope: 'project', path: '../x' }, ctx), /非法/);
  assert.equal(isProjectUserPath('src/.git/config'), false);
  assert.match(await executeTool('execute_javascript', { scope: 'project', code: '' }, ctx), /不支持项目作用域/);
});

test('project Git is isolated, local-only, atomic and hides metadata', async () => {
  const p = createProjectFS({ state: {}, notify() {} }), fs = createFS({ 'private.txt': 'private' });
  const ctx = { fs, projectFs: p, sandboxEnabled: true };
  p.write('hello.txt', 'hello');
  for (const command of ['git init', 'git add .', 'git commit -m first']) assert.match(await executeTool('run_git', { scope: 'project', command }, ctx), /退出码 0/);
  assert.match(await executeTool('run_git', { scope: 'project', command: 'git log' }, ctx), /first/);
  assert.doesNotMatch(await executeTool('list_files', { scope: 'project' }, ctx), /\.git/);
  assert.match(await executeTool('run_git', { scope: 'project', command: 'git push' }, ctx), /远端/);
  assert.equal(fs.read('private.txt'), 'private'); assert.equal(fs.has('.git/dubhe.json'), false);
  const before = p.export();
  const failing = { ...p, replaceAll() { throw Error('quota'); } };
  assert.match(await executeTool('run_git', { scope: 'project', command: 'git branch feature' }, { ...ctx, projectFs: failing }), /quota/);
  assert.deepEqual(p.export(), before);
});

test('import reviews all text chunks locally and rejects archives, invalid UTF-8 and oversized text', async () => {
  const chunks = [], textReview = async ({ text, apiKey }) => { chunks.push(text); assert.equal(apiKey, ''); return { blocked: text.includes('BLOCK') }; };
  const f = new File(['a'.repeat(9000) + 'BLOCK'], 'src.js');
  assert.equal((await reviewProjectImport(f, { textReview })).ok, false); assert.equal(chunks.length, 2);
  const allowed = await reviewProjectImport(new File(['console.log(1)'], 'src.js'), { textReview });
  assert.equal(allowed.content, 'console.log(1)');
  for (const bytes of [new Uint8Array([0x50, 0x4b, 3, 4, 0]), new Uint8Array([0xff, 0xfe]), new Uint8Array(1024 * 1024 + 1).fill(65)]) {
    assert.equal((await reviewProjectImport(new File([bytes], 'archive.zip'), { textReview })).ok, false);
  }
});

test('image imports fail closed when the local model is unavailable or uncertain', async () => {
  const bytes = new Uint8Array(25); bytes.set([0x89, 0x50, 0x4e, 0x47]);
  const image = new File([bytes], 'img.png');
  for (const decision of [{ blocked: true }, { degraded: true }, { uncertain: true }, { skipped: 'no-images' }]) {
    assert.equal((await reviewProjectImport(image, { imageReview: async () => decision })).ok, false);
  }
  let options;
  const result = await reviewProjectImport(image, { imageReview: async o => { options = o; return { blocked: false }; } });
  assert.match(result.content, /^data:image\/png;base64,/); assert.equal(options.remoteReview, false); assert.equal(options.apiKey, '');
});

test('every tree item uses drawn SVG and folders have distinct open and closed glyphs', () => {
  assert.notEqual(projectIconSvg(projectIconType('src', true, false)), projectIconSvg(projectIconType('src', true, true)));
  for (const path of ['app.js', 'x.ts', 'a.tsx', 'x.css', 'main.py', 'logo.png', 'README.md', 'image.svg', 'a.zip', 'unknown']) {
    const html = projectIconSvg(projectIconType(path)); assert.match(html, /^<svg/); assert.match(html, /<(path|rect|circle|ellipse)\b/); assert.doesNotMatch(html, /<text/);
  }
});
