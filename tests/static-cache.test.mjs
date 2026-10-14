import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, webcrypto } from 'node:crypto';
import { stampFiles } from '../tools/stamp-version.mjs';
const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/dubhe-agent/';
const prefix = 'dubhe-static-v3:%2Fdubhe-agent%2F:';
const version = n => `2026.10.14.${n}`;
const name = n => prefix + version(n);
const sha = s => createHash('sha256').update(s).digest('hex');
const defaults = () => ({ 'index.html': '<h1>Home</h1>', 'app.html': '<h1>App</h1>', 'js/a.js': 'export const a=1;', 'js/b.js': 'export const b=1;', 'css/a.css': 'body{color:black}', 'assets/vendor/lazy.js': 'lazy1', 'assets/moderation/large.bin': 'model1' });
function world() {
  const stores = new Map(), requests = [], handlers = new Map();
  let files = defaults(), revision = 1, offline = false, override = {}, quota = false, badManifest;
  const key = r => typeof r === 'string' ? r : r.url;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
    async open(n) {
      if (!stores.has(n)) stores.set(n, new Map());
      const entries = stores.get(n);
      return { async keys() { return [...entries.keys()].map(u => new Request(u)); }, async match(r) { return entries.get(key(r))?.clone(); }, async delete(r) { return entries.delete(key(r)); }, async put(r, res) { if (quota) throw Error('QuotaExceededError'); entries.set(key(r), res.clone()); } };
    },
  };
  const manifest = () => badManifest || ({ schema: 'dubhe-build-manifest/1', version: version(revision), files: Object.fromEntries(Object.entries(files).map(([p, s]) => [p, { size: Buffer.byteLength(s), sha256: sha(s) }])) });
  const fetch = async (input, options) => {
    const url = key(input); requests.push(url);
    if (offline) throw Error('Offline');
    if (url === scope + 'build.json') return Response.json(manifest());
    const p = new URL(url).origin === new URL(scope).origin ? new URL(url).pathname.slice('/dubhe-agent/'.length) : url;
    return p in files ? new Response(override[p] ?? files[p]) : new Response('not found', { status: 404 });
  };
  function worker(n) {
    const events = new Map(); let claimed = 0, skipped = 0;
    const ctx = vm.createContext({ URL, Request, Response, Headers, Map, Set, Uint8Array, crypto: webcrypto, caches, fetch, AbortController, setTimeout, clearTimeout, console,
      self: { registration: { scope }, clients: { claim: async () => { claimed++; } }, skipWaiting() { skipped++; }, addEventListener(type, fn) { events.set(type, fn); } },
    });
    vm.runInContext(source.replace("const DEPLOY_VERSION = 'source'", `const DEPLOY_VERSION = '${version(n)}'`), ctx);
    const event = async type => { let p; events.get(type)({ waitUntil(v) { p = v; } }); await p; };
    return { install: () => event('install'), activate: () => event('activate'), skipped: () => skipped, claimed: () => claimed,
      read: exp => vm.runInContext(exp, ctx), message: data => events.get('message')({ data }),
      fetch(url, init) { let p; events.get('fetch')({ request: new Request(url.startsWith('http') ? url : scope + url, init), respondWith(v) { p = v; } }); return p; },
    };
  }
  return { caches, requests, worker, stores, reset() { requests.length = 0; }, set(n, f = files) { revision = n; files = f; }, files: () => files,
    offline(v = true) { offline = v; }, corrupt(p, v) { override[p] = v; }, quota(v = true) { quota = v; }, manifest(v) { badManifest = v; } };
}
test('cold install pre-caches all site scripts/styles/pages, not large lazy dependencies', async () => {
  const w = world(), sw = w.worker(1); await sw.install(); await sw.activate();
  assert.equal(sw.skipped(), 0); assert.equal(sw.claimed(), 1);
  const paths = (await (await w.caches.open(name(1))).keys()).map(r => r.url);
  for (const p of ['index.html', 'app.html', 'js/a.js', 'js/b.js', 'css/a.css']) assert.ok(paths.includes(scope + p));
  assert.ok(!paths.includes(scope + 'assets/vendor/lazy.js'));
  assert.ok(!paths.includes(scope + 'assets/moderation/large.bin'));
});
test('cache hit has no network revalidation, even with legacy version query or offline navigation', async () => {
  const w = world(), sw = w.worker(1); await sw.install(); w.reset(); w.offline();
  assert.match(await (await sw.fetch('js/a.js?v=2026.10.1.1')).text(), /a=1/);
  assert.equal(await (await sw.fetch('')).text(), '<h1>Home</h1>'); assert.equal(w.requests.length, 0);
});
test('lazy assets download once, concurrent misses are coalesced, next use works offline', async () => {
  const w = world(), sw = w.worker(1); await sw.install(); w.reset();
  const responses = await Promise.all(Array.from({ length: 4 }, () => sw.fetch('assets/vendor/lazy.js')));
  assert.deepEqual(await Promise.all(responses.map(r => r.text())), Array(4).fill('lazy1'));
  assert.equal(w.requests.length, 1); w.offline();
  assert.equal(await (await sw.fetch('assets/vendor/lazy.js')).text(), 'lazy1');
});
test('identical next build only fetches its manifest, not unchanged assets', async () => {
  const w = world(); await w.worker(1).install(); w.set(2); w.reset(); await w.worker(2).install();
  assert.deepEqual(w.requests, [scope + 'build.json']);
});
test('update downloads changed/new files and previously-used changed lazy assets, not new unused dependencies', async () => {
  const w = world(), old = w.worker(1); await old.install(); await old.fetch('assets/vendor/lazy.js');
  const next = { ...w.files(), 'js/a.js': 'export const a=2;', 'js/c.js': 'export const c=1;', 'assets/vendor/lazy.js': 'lazy2', 'assets/vendor/new-large.js': 'unused' }; delete next['js/b.js'];
  w.set(2, next); w.reset(); const sw = w.worker(2); await sw.install();
  assert.deepEqual(w.requests.map(u => u.replace(scope, '')).sort(), ['build.json', 'js/a.js', 'js/c.js', 'assets/vendor/lazy.js'].sort());
  assert.equal(await (await old.fetch('js/a.js')).text(), 'export const a=1;', 'old tabs keep the old coherent build until activation');
  assert.ok((await w.caches.keys()).includes(name(1)));
  await sw.activate(); assert.ok(!(await w.caches.keys()).includes(name(1)));
  assert.equal(await (await sw.fetch('js/a.js')).text(), 'export const a=2;');
  assert.equal(await (await w.caches.open(name(2))).match(scope + 'js/b.js'), undefined);
});
test('integrity mismatch rejects entire new installation, preserves last good version', async () => {
  const w = world(), old = w.worker(1); await old.install(); w.set(2, { ...w.files(), 'js/a.js': 'export const a=2;' }); w.corrupt('js/a.js', 'corrupt');
  await assert.rejects(w.worker(2).install(), /integrity/);
  assert.ok(!(await w.caches.keys()).includes(name(2))); assert.ok((await w.caches.keys()).includes(name(1)));
  assert.equal(await (await old.fetch('js/a.js')).text(), 'export const a=1;');
});
test('network failure during update leaves previous cache usable', async () => {
  const w = world(), old = w.worker(1); await old.install(); w.set(2); w.offline();
  await assert.rejects(w.worker(2).install(), /Offline/); assert.equal(await (await old.fetch('js/b.js')).text(), 'export const b=1;');
});
test('quota failure aborts installation; lazy cache-put failure does not block current use', async () => {
  const w = world(), old = w.worker(1); await old.install(); w.set(2); w.quota();
  await assert.rejects(w.worker(2).install(), /Quota/); assert.ok(!(await w.caches.keys()).includes(name(2)));
  assert.equal(await (await old.fetch('assets/vendor/lazy.js')).text(), 'lazy1');
});
test('POST/API/auth/range/workspace/arbitrary CDN requests are never intercepted', async () => {
  const sw = world().worker(1);
  for (const p of ['api/chat', 'v1/models', 'workspace/private.js', 'https://other.test/lib.js', 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/a.js?key=private']) assert.equal(sw.fetch(p), undefined);
  for (const init of [{ method: 'POST', body: 'secret' }, { headers: { Authorization: 'Bearer test-only' } }, { headers: { Range: 'bytes=0-2' } }]) assert.equal(sw.fetch('js/a.js', init), undefined);
  assert.equal(sw.fetch('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/a.js', { credentials: 'include' }), undefined);
});
test('pinned Pyodide dependencies are lazy, reused and retained across unchanged runtime versions', async () => {
  const url = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.asm.wasm';
  const w = world(); w.set(1, { ...w.files(), [url]: 'wasm' });
  // External resources are not part of the same-origin build manifest.
  const m = { schema: 'dubhe-build-manifest/1', version: version(1), files: Object.fromEntries(Object.entries(defaults()).map(([p, s]) => [p, { size: s.length, sha256: sha(s) }])) }; w.manifest(m);
  const sw = w.worker(1); await sw.install(); w.reset(); assert.equal(await (await sw.fetch(url)).text(), 'wasm'); assert.equal(w.requests.length, 1);
  w.reset(); await sw.fetch(url); assert.equal(w.requests.length, 0);
  m.version = version(2); const next = w.worker(2); await next.install(); w.reset(); await next.fetch(url); assert.equal(w.requests.length, 0);
});
test('activation only cleans older caches of this app scope, not future/foreign caches', async () => {
  const w = world(); await w.worker(1).install(); w.set(2); const sw = w.worker(2); await sw.install();
  for (const n of [name(3), 'other-app', 'dubhe-static-v3:%2Fother%2F:2026.10.14.1']) await w.caches.open(n);
  await sw.activate(); const names = await w.caches.keys();
  assert.ok(!names.includes(name(1))); for (const n of [name(2), name(3), 'other-app', 'dubhe-static-v3:%2Fother%2F:2026.10.14.1']) assert.ok(names.includes(n));
});
test('legacy cached assets are hashed and reused, old scope entries removed without touching another site', async () => {
  const w = world(), legacy = await w.caches.open('dubhe-assets-v2');
  await legacy.put(scope + 'assets/vendor/lazy.js?v=old', new Response('lazy1')); await legacy.put('https://example.test/other/assets/keep.js', new Response('keep'));
  const sw = w.worker(1); await sw.install(); assert.ok(!w.requests.some(u => u.includes('lazy.js')));
  assert.equal(await (await sw.fetch('assets/vendor/lazy.js')).text(), 'lazy1'); await sw.activate();
  assert.equal((await legacy.keys()).length, 1); assert.ok(await legacy.match('https://example.test/other/assets/keep.js'));
});
test('corrupt legacy asset gets refreshed rather than trusted', async () => {
  const w = world(), cache = await w.caches.open('dubhe-assets-v2'); await cache.put(scope + 'assets/vendor/lazy.js', new Response('bad'));
  const sw = w.worker(1); await sw.install(); assert.equal(await (await sw.fetch('assets/vendor/lazy.js')).text(), 'lazy1'); assert.ok(w.requests.some(u => u.endsWith('lazy.js')));
});
test('storage eviction rebuilds the matching version, instead of leaving a permanently empty cache', async () => {
  const w = world(), sw = w.worker(1); await sw.install(); await sw.fetch('js/a.js'); await w.caches.delete(name(1)); w.reset();
  assert.equal(await (await sw.fetch('js/a.js')).text(), 'export const a=1;'); assert.ok(w.requests.includes(scope + 'build.json'));
  assert.ok(await (await w.caches.open(name(1))).match(scope + '__dubhe_cache_manifest__'));
  w.reset(); await sw.fetch('js/a.js'); assert.equal(w.requests.length, 0);
});
test('clear-cache message disables cache writes and forgets worker metadata', async () => {
  const w = world(), sw = w.worker(1); await sw.install(); sw.message({ type: 'dubhe-cache-cleared' }); assert.equal(sw.fetch('js/a.js'), undefined);
});
test('malformed manifest/version mismatch cannot activate a partial build', async () => {
  const w = world(); w.set(2); await assert.rejects(w.worker(1).install(), /Deployment/);
  w.manifest({ schema: 'dubhe-build-manifest/1', version: version(1), files: { '../private': { sha256: sha('x'), size: 1 } } }); await assert.rejects(w.worker(1).install(), /manifest path/);
  w.manifest({ schema: 'dubhe-build-manifest/1', version: version(1), files: { 'js/a.js': { sha256: 'invalid', size: 1 } } }); await assert.rejects(w.worker(1).install(), /entry/);
});
test('deploy stamping keeps unchanged module bytes stable across versions, stamps SW and displayed version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dubhe-stamp-test-'));
  try {
    fs.mkdirSync(path.join(root, 'js')); fs.mkdirSync(path.join(root, 'demo'));
    fs.writeFileSync(path.join(root, 'js/config.js'), "export const APP_VERSION = '2026.10.11.1';");
    fs.writeFileSync(path.join(root, 'js/a.js'), "import './config.js?v=2026.10.11.1'; export const a=1;");
    fs.writeFileSync(path.join(root, 'app.html'), '<meta name="app-version" content="2026.10.11.1"><script src="js/a.js?v=2026.10.11.1"></script>');
    fs.writeFileSync(path.join(root, 'sw.js'), source); stampFiles(version(1), root);
    const hash1 = sha(fs.readFileSync(path.join(root, 'js/a.js'))); stampFiles(version(2), root);
    assert.equal(sha(fs.readFileSync(path.join(root, 'js/a.js'))), hash1);
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'js/a.js'), 'utf8'), /\?v=/);
    assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /DEPLOY_VERSION = '2026.10.14.2'/);
    assert.match(fs.readFileSync(path.join(root, 'app.html'), 'utf8'), /content="2026.10.14.2"/);
    assert.equal(stampFiles(version(2), root).length, 0, 'stamping is reproducible and idempotent');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
