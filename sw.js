/* Dubhe Agent: manifest-verified incremental static cache.
 * Core scripts/styles/pages, local UI logos/app icons and required fonts are prepared atomically;
 * large assets (including assets/geo, audio, PDF/OCR models) and pinned Pyodide dependencies stay lazy.
 * No API responses, credentials, conversations or user workspace files are cached.
 * Waiting workers never interrupt active tabs; old caches are removed on activation.
 */
const DEPLOY_VERSION = 'source'; // stamped only in the deployment artifact
const SCOPE = self.registration.scope;
const ORIGIN = new URL(SCOPE).origin;
const PREFIX = 'dubhe-static-v3:' + encodeURIComponent(new URL(SCOPE).pathname) + ':';
const CACHE = PREFIX + DEPLOY_VERSION;
const META = new URL('__dubhe_cache_manifest__', SCOPE).href;
const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let manifestPromise;
let cacheDisabled = false;
let networkOffline = self.navigator?.onLine === false;
let lastRecovery = 0;
const activeNetworkControllers = new Set();
const isNetworkOffline = () => networkOffline || self.navigator?.onLine === false;
function assertOnline() { if (isNetworkOffline()) throw Error('Offline mode blocks network access.'); }
function setNetworkOffline(value) {
  networkOffline = value === true;
  if (networkOffline) for (const controller of activeNetworkControllers) controller.abort();
}
async function networkFetch(input, options = {}) {
  assertOnline();
  const controller = new AbortController();
  activeNetworkControllers.add(controller);
  try { return await fetch(input, { ...options, signal: controller.signal }); }
  finally { activeNetworkControllers.delete(controller); }
}
let cacheProgress = { phase: 'idle', version: DEPLOY_VERSION, completed: 0, total: 0 };
let progressQueue = Promise.resolve();
function reportCacheProgress(next, broadcast = true) {
  cacheProgress = { type: 'dubhe-cache-progress', version: DEPLOY_VERSION, ...next };
  if (!broadcast) return Promise.resolve();
  const message = { ...cacheProgress };
  progressQueue = progressQueue.then(async () => {
    let clients = [];
    try { clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); } catch { return; }
    for (const client of clients) {
      try { if (new URL(client.url).origin === ORIGIN) client.postMessage(message); } catch { /* closed or inaccessible tab */ }
    }
  }).catch(() => {});
  return progressQueue;
}
self.addEventListener('message', event => {
  if (event.data?.type === 'dubhe-network-state') {
    setNetworkOffline(event.data.offline === true);
    return;
  }
  if (event.data?.type === 'dubhe-cache-cleared') { cacheDisabled = true; manifestPromise = null; }
  else if (event.data?.type === 'dubhe-cache-progress-request') {
    try { event.source?.postMessage({ ...cacheProgress, type: 'dubhe-cache-progress' }); } catch { /* requesting tab closed */ }
  } else if (event.data?.type === 'dubhe-cache-refresh-request' && event.data.version === DEPLOY_VERSION && event.waitUntil && !isNetworkOffline()) {
    event.waitUntil(prepare({ notifyProgress: true }).catch(async error => {
      await reportCacheProgress({ phase: 'error', completed: cacheProgress.completed || 0, total: cacheProgress.total || 0 });
      throw error;
    }));
  }
});
const inflight = new Map();

function staticPath(path) {
  if (!path || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) return false;
  return /^(?:js|css|assets|fonts|demo)\//.test(path) || /^(?:index|app|docs)\.html$/.test(path) || path === 'manifest.webmanifest';
}
function corePath(path) {
  return /^js\/.*\.m?js$/.test(path) || /^css\/.*\.css$/.test(path)
    || /^(?:index|app|docs)\.html$/.test(path) || /^demo\/.*\.(?:html|css)$/.test(path)
    || /^assets\/(?:md|hljs|katex)\/.*\.(?:js|css)$/.test(path)
    || /^assets\/(?:skills\/.*\.(?:json|md)|knowledge\/index\.json)$/.test(path)
    || /^assets\/vendor\/wllama\/wllama-3\.8\.1\.(?:js|wasm)$/.test(path)
    || /^assets\/vendor\/office\/[^/]+\.js$/.test(path)
    || /^assets\/icons\/[^/]+\.svg$/i.test(path) || /^assets\/app-icon-\d+\.png$/i.test(path)
    || /^assets\/katex\/fonts\/.*\.(?:woff2?|ttf|otf)$/i.test(path)
    || /^fonts\/.*\.(?:css|woff2?|ttf|otf)$/i.test(path);
}
function relativePath(url) {
  const u = new URL(url);
  if (u.origin !== ORIGIN || !u.pathname.startsWith(new URL(SCOPE).pathname)) return '';
  const path = u.pathname.slice(new URL(SCOPE).pathname.length) || 'index.html';
  return staticPath(path) ? path : '';
}
function lazyExternal(url) {
  const u = new URL(url);
  return !u.search && u.href.startsWith(PYODIDE_BASE) && !u.pathname.includes('..');
}
function validateManifest(m) {
  if (m?.schema !== 'dubhe-build-manifest/1' || !m.files || typeof m.files !== 'object') throw Error('Invalid build manifest');
  if (DEPLOY_VERSION !== 'source' && m.version !== DEPLOY_VERSION) throw Error('Deployment is not ready');
  for (const [path, entry] of Object.entries(m.files)) {
    if (!/^[^?#\s]+$/.test(path) || path.startsWith('/') || path.includes('\\') || path.split('/').some(p => p === '.' || p === '..')) throw Error('Invalid manifest path');
    if (!/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw Error('Invalid manifest entry');
  }
  if (!m.files['app.html'] || !m.files['index.html']) throw Error('Missing entrypoints');
  return m;
}
async function timedFetch(url, options = {}) {
  assertOnline();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  activeNetworkControllers.add(controller);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); activeNetworkControllers.delete(controller); }
}
async function matches(response, entry) {
  if (!response.ok || response.type === 'opaque') return false;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== entry.size) return false;
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  return hash === entry.sha256;
}
async function verified(path, entry) {
  const url = new URL(path, SCOPE);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) url.searchParams.set('__asset_hash', entry.sha256);
    const res = await timedFetch(url.href, { cache: attempt ? 'reload' : 'force-cache', credentials: 'omit' });
    if (await matches(res, entry)) return res;
  }
  throw Error('Static asset integrity mismatch: ' + path);
}
async function metadata(cache) {
  try { return await (await cache.match(META))?.json(); } catch { return null; }
}
function currentManifest() {
  return manifestPromise ||= caches.open(CACHE).then(metadata).then(async m => {
    if (m) return m;
    if (isNetworkOffline()) { manifestPromise = null; return null; }
    // Browser storage may be evicted independently of SW registration. Rebuild
    // once, with backoff on quota/network failure; never use a different build.
    if (!cacheDisabled && Date.now() - lastRecovery > 60000) {
      lastRecovery = Date.now();
      try { await prepare(); return await metadata(await caches.open(CACHE)); } catch { /* online fallback */ }
    }
    manifestPromise = null;
    return null;
  });
}
async function prepare({ notifyProgress = false } = {}) {
  assertOnline();
  if (notifyProgress) await reportCacheProgress({ phase: 'manifest', completed: 0, total: 0 });
  const response = await timedFetch(new URL('build.json', SCOPE).href, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw Error('No deployment manifest; leave development pages uncached');
  const next = validateManifest(await response.json());
  const prior = [];
  for (const name of (await caches.keys()).filter(n => n.startsWith(PREFIX) && n !== CACHE).reverse()) {
    const cache = await caches.open(name), manifest = await metadata(cache);
    if (manifest) prior.push({ cache, manifest });
  }
  // One-time migration of the former shared asset cache: hash-check its bytes,
  // so unchanged OCR models/audio need not be downloaded again.
  if ((await caches.keys()).includes('dubhe-assets-v2')) {
    const cache = await caches.open('dubhe-assets-v2'), keys = new Map();
    for (const req of await cache.keys()) { const p = relativePath(req.url); if (p) keys.set(p, req.url); }
    prior.push({ cache, legacy: true, keys });
  }
  if (cacheDisabled) throw Error('Cache cleared');
  const cache = await caches.open(CACHE);
  const wanted = new Set(Object.keys(next.files).filter(corePath));
  const external = new Set();
  for (const old of prior) for (const request of await old.cache.keys()) {
    const path = relativePath(request.url);
    if (path && next.files[path]) wanted.add(path); // keep used lazy assets, but not deleted files
    else if (lazyExternal(request.url)) external.add(request.url);
  }
  const jobs = [...wanted]; let cursor = 0, completed = 0, failure;
  const progressEvery = Math.max(1, Math.ceil(jobs.length / 80));
  if (notifyProgress) await reportCacheProgress({ phase: 'cache', completed: 0, total: jobs.length });
  const run = async () => {
    while (cursor < jobs.length && !failure) {
      const path = jobs[cursor++], key = new URL(path, SCOPE).href;
      try {
        let hit;
        for (const old of prior) if (old.legacy || old.manifest.files[path]?.sha256 === next.files[path].sha256) {
          hit = await old.cache.match(old.keys?.get(path) || key);
          if (hit && (!old.legacy || await matches(hit, next.files[path]))) break;
          hit = null;
        }
        if (cacheDisabled) throw Error('Cache cleared');
        await cache.put(key, hit || await verified(path, next.files[path]));
        completed++;
        if (notifyProgress && (completed === jobs.length || completed % progressEvery === 0)) {
          await reportCacheProgress({ phase: 'cache', completed, total: jobs.length });
        }
      } catch (error) { failure = error; }
    }
  };
  await Promise.all(Array.from({ length: 4 }, run));
  if (failure) { await caches.delete(CACHE); throw failure; }
  try {
    for (const url of external) for (const old of prior) {
      const hit = await old.cache.match(url); if (hit) { await cache.put(url, hit); break; }
    }
    // Ready marker goes LAST. A partial install can never replace the previous version.
    if (cacheDisabled) throw Error('Cache cleared');
    await cache.put(META, new Response(JSON.stringify(next), { headers: { 'Content-Type': 'application/json' } }));
    if (notifyProgress) await reportCacheProgress({ phase: 'ready', completed: jobs.length, total: jobs.length });
  } catch (error) { await caches.delete(CACHE); throw error; }
}
self.addEventListener('install', event => {
  if (isNetworkOffline()) return;
  event.waitUntil(prepare({ notifyProgress: true }).catch(async error => {
    await reportCacheProgress({ phase: 'error', completed: cacheProgress.completed || 0, total: cacheProgress.total || 0 });
    throw error;
  }));
});
function olderVersion(name) {
  const version = name.slice(PREFIX.length);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) return version === 'source';
  const a = version.split('.').map(Number), b = DEPLOY_VERSION.split('.').map(Number);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE && name.startsWith(PREFIX) && olderVersion(name)) await caches.delete(name);
      if (name === 'dubhe-assets-v2') {
        const legacy = await caches.open(name);
        for (const req of await legacy.keys()) if (relativePath(req.url)) await legacy.delete(req);
        if (!(await legacy.keys()).length) await caches.delete(name);
      }
    }
    await self.clients.claim();
  })());
});
function singleFlight(key, work) {
  if (!inflight.has(key)) inflight.set(key, work().finally(() => inflight.delete(key)));
  return inflight.get(key).then(response => response.clone());
}
async function offlineCacheOnly(request, path, external) {
  const unavailable = () => new Response('Offline mode: resource is not present in the local cache.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  if (cacheDisabled || request.method !== 'GET' || request.headers.has('Authorization') || request.headers.has('Range')) return unavailable();
  if (!path && !external) return unavailable();
  const key = external ? request.url : new URL(path, SCOPE).href;
  const names = await caches.keys();
  const candidates = [CACHE, ...names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).reverse()];
  for (const name of candidates) {
    try {
      const hit = await (await caches.open(name)).match(key);
      if (hit) return hit;
    } catch { /* try the next known static cache */ }
  }
  return unavailable();
}
self.addEventListener('fetch', event => {
  const req = event.request;
  const path = relativePath(req.url), external = lazyExternal(req.url);
  if (isNetworkOffline()) {
    event.respondWith(offlineCacheOnly(req, path, external));
    return;
  }
  if (cacheDisabled || req.method !== 'GET' || req.headers.has('Authorization') || req.headers.has('Range')) return;
  if ((!path && !external) || (external && req.credentials === 'include')) return;
  event.respondWith((async () => {
    let manifest = await currentManifest();
    // Storage eviction / manual clearing: recover via network, never treat APIs as static.
    if (!manifest) return networkFetch(req, { cache: 'no-store' });
    if (path && !manifest.files[path]) return networkFetch(req);
    const key = external ? req.url : new URL(path, SCOPE).href;
    let cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit; // no conditional request and no background re-download
    if (!await cache.match(META)) {
      manifestPromise = null; manifest = await currentManifest();
      if (!manifest) return networkFetch(req, { cache: 'no-store' });
      cache = await caches.open(CACHE);
      const recovered = await cache.match(key); if (recovered) return recovered;
    }
    return singleFlight(key, async () => {
      const response = external
        ? await networkFetch(req.url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' }).catch(() => networkFetch(req))
        : await verified(path, manifest.files[path]);
      if (!cacheDisabled && response.ok && response.type !== 'opaque') {
        try { await cache.put(key, response.clone()); } catch { /* quota/eviction: current use remains available */ }
      }
      return response;
    });
  })().catch(() => new Response('Offline asset unavailable or integrity verification failed.', { status: 503 })));
});

// Optional local completion alerts. No push service, analytics or prompt content.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = windows.find(c => new URL(c.url).pathname === new URL('app.html', SCOPE).pathname);
    if (app) { await app.focus(); app.postMessage({ type: 'dubhe-notification-open', sessionId: event.notification.data?.sessionId || '' }); }
    else {
      const url = new URL('app.html', SCOPE);
      if (event.notification.data?.sessionId) url.searchParams.set('session', event.notification.data.sessionId);
      await self.clients.openWindow(url.href);
    }
  })());
});
