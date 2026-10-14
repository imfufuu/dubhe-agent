// Real SW lifecycle/network test against a small, version-switchable fixture server.
// No gateway requests or external libraries. The production sw.js is used unchanged,
// apart from the same deploy-version stamp used by Pages.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
let revision = 1, corrupt = false;
const hits = [];
const pageHTML = '<!doctype html><title>Cache lifecycle fixture</title><h1>Cache lifecycle</h1>';
function files() {
  const f = { 'index.html': pageHTML, 'app.html': pageHTML, 'js/a.js': `export const a=${revision};`, 'assets/vendor/lazy.js': `lazy${revision}`, 'assets/vendor/new-large.js': 'unused' };
  if (revision === 1) { f['js/b.js'] = 'export const b=1;'; f['assets/vendor/removed.js'] = 'old'; }
  else f['js/c.js'] = 'export const c=1;';
  return f;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost'); hits.push(u.pathname);
  const p = u.pathname.replace(/^\/site\//, '');
  res.setHeader('Cache-Control', 'no-store');
  if (u.pathname === '/control.html') { res.setHeader('Content-Type', 'text/html'); return res.end(pageHTML); }
  if (p === 'sw.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(source.replace("const DEPLOY_VERSION = 'source'", `const DEPLOY_VERSION = '2026.10.14.${revision}'`)); }
  if (p === 'build.json') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ schema: 'dubhe-build-manifest/1', version: `2026.10.14.${revision}`, files: Object.fromEntries(Object.entries(files()).map(([p, body]) => [p, { sha256: createHash('sha256').update(body).digest('hex'), size: Buffer.byteLength(body) }])) }));
  }
  if (p in files()) {
    res.setHeader('Content-Type', p.endsWith('.html') ? 'text/html' : 'text/javascript');
    if (p.endsWith('.js')) res.setHeader('Cache-Control', 'public, max-age=86400'); // exercise stale HTTP-cache hash rejection
    return res.end(corrupt && p === 'js/a.js' ? 'tampered' : files()[p]);
  }
  res.statusCode = 404; res.end('not found');
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(); let checks = 0;
try {
  const context = await browser.newContext(), page = await context.newPage();
  await page.goto(base + '/site/app.html');
  await page.evaluate(async () => { await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }); await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller); checks++;
  const get = (p, url) => p.evaluate(async url => ({ status: (await fetch(url)).status, body: await (await fetch(url)).text() }), url);
  hits.length = 0;
  assert.equal((await get(page, './js/a.js')).body, 'export const a=1;');
  assert.equal((await get(page, './js/b.js')).body, 'export const b=1;');
  assert.equal(hits.length, 0); checks++;
  assert.ok(!(await page.evaluate(async () => { const c = await caches.open('dubhe-static-v3:%2Fsite%2F:2026.10.14.1'); return (await c.keys()).map(r => r.url); })).some(u => u.includes('new-large'))); checks++;
  await get(page, './assets/vendor/lazy.js'); await get(page, './assets/vendor/removed.js');
  assert.equal(hits.filter(u => u.endsWith('/lazy.js')).length, 1); checks++;
  await page.evaluate(() => caches.open('other-app-cache'));
  revision = 2; hits.length = 0;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg.waiting) return;
    await new Promise((resolve, reject) => {
      const w = reg.installing;
      if (!w) return reject(Error('No installing worker'));
      const check = () => { if (w.state === 'installed') resolve(); if (w.state === 'redundant') reject(Error('Installation failed')); };
      w.addEventListener('statechange', check); check();
    });
  });
  assert.deepEqual(hits.filter(u => /\.(?:js|html)$/.test(u) && !u.endsWith('/sw.js')).sort(), ['/site/js/a.js', '/site/js/c.js', '/site/assets/vendor/lazy.js'].sort()); checks++;
  assert.equal((await get(page, './js/a.js')).body, 'export const a=1;', 'waiting update must not replace active-tab modules'); checks++;
  const control = await context.newPage(); await control.goto(base + '/control.html');
  await page.close(); // natural activation: no skipWaiting, no forced reload
  await control.evaluate(async () => {
    const deadline = Date.now() + 15000;
    while ((await caches.keys()).includes('dubhe-static-v3:%2Fsite%2F:2026.10.14.1')) {
      if (Date.now() > deadline) throw Error('Old cache was not removed');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });
  const keys = await control.evaluate(() => caches.keys()); assert.ok(keys.includes('other-app-cache')); checks++;
  const next = await context.newPage(); hits.length = 0; await next.goto(base + '/site/app.html');
  assert.equal((await get(next, './js/a.js')).body, 'export const a=2;');
  assert.equal((await get(next, './assets/vendor/lazy.js')).body, 'lazy2'); assert.equal(hits.length, 0); checks++;
  const stored = await next.evaluate(async () => (await (await caches.open('dubhe-static-v3:%2Fsite%2F:2026.10.14.2')).keys()).map(r => r.url));
  assert.ok(!stored.some(u => u.endsWith('/js/b.js') || u.endsWith('/removed.js'))); checks++;
  await context.setOffline(true); await next.reload(); assert.equal((await get(next, './js/c.js')).body, 'export const c=1;'); checks++;
  await context.setOffline(false); revision = 3; corrupt = true;
  await next.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    window.installFailed = false;
    reg.addEventListener('updatefound', () => { const w = reg.installing; w.addEventListener('statechange', () => { if (w.state === 'redundant') window.installFailed = true; }); });
    await reg.update();
  });
  await next.waitForFunction(() => window.installFailed);
  assert.ok(!(await next.evaluate(() => caches.keys())).includes('dubhe-static-v3:%2Fsite%2F:2026.10.14.3'));
  assert.equal((await get(next, './js/a.js')).body, 'export const a=2;'); checks++;
  console.log(`Chromium real Service Worker lifecycle: ${checks} passed (incremental network, lazy assets, safe activation, deletion, offline, failed-update rollback).`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
