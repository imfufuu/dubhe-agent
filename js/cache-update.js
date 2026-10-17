// One-click, manifest-aware static-cache refresh. The Service Worker remains
// waiting while other tabs are active; this module only downloads and verifies
// the next cache, never interrupts the running page.
const DEFAULT_SCOPE = new URL('../', import.meta.url).href;
const VERSION_RE = /^\d{4}\.\d{1,2}\.\d{1,2}\.\d+$/;
const META_NAME = '__dubhe_cache_manifest__';

function makeError(code, cause) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function validVersion(value) { return VERSION_RE.test(String(value || '')); }

export function compareBuildVersions(left, right) {
  if (!validVersion(left) || !validVersion(right)) throw makeError('invalid-version');
  const a = String(left).split('.').map(Number), b = String(right).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

async function hasReadyCache(cachesImpl, scope, version) {
  if (!cachesImpl?.keys || !cachesImpl?.open) return false;
  try {
    const root = new URL(scope);
    const prefix = `dubhe-static-v3:${encodeURIComponent(root.pathname)}:`;
    const metaUrl = new URL(META_NAME, root).href;
    for (const name of await cachesImpl.keys()) {
      if (!name.startsWith(prefix)) continue;
      try {
        const cache = await cachesImpl.open(name);
        const response = await cache.match(metaUrl);
        if (!response) continue;
        const manifest = await response.json();
        if (manifest?.schema === 'dubhe-build-manifest/1' && manifest.version === version) return true;
      } catch { /* a stale or evicted cache is not proof of a complete update */ }
    }
  } catch { /* Cache Storage may be unavailable in private/older browsers */ }
  return false;
}

function safeProgress(data) {
  const total = Number.isFinite(Number(data.total)) ? Math.max(0, Math.floor(Number(data.total))) : 0;
  const completed = Number.isFinite(Number(data.completed)) ? Math.max(0, Math.floor(Number(data.completed))) : 0;
  return {
    phase: String(data.phase || 'cache'),
    version: String(data.version || ''),
    completed: total ? Math.min(total, completed) : completed,
    total,
  };
}

/**
 * Check the uncached deployment manifest and, when needed, ask the site's
 * Service Worker to install its manifest-verified static cache. Progress is
 * reported by the installing worker after each batch of assets.
 */
export async function updateScriptCache({
  currentVersion,
  fetchImpl = globalThis.fetch,
  navigatorImpl = globalThis.navigator,
  cachesImpl = globalThis.caches,
  scope = DEFAULT_SCOPE,
  timeoutMs = 120000,
  now = Date.now,
  onProgress = () => {},
} = {}) {
  if (!validVersion(currentVersion)) throw makeError('invalid-current-version');
  if (typeof fetchImpl !== 'function') throw makeError('fetch-unavailable');

  const root = new URL(scope);
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  const scopeUrl = root.href;
  const manifestUrl = new URL('build.json', scopeUrl);
  manifestUrl.searchParams.set('check', String(now()));

  let response;
  try { response = await fetchImpl(manifestUrl.href, { cache: 'no-store', credentials: 'omit' }); }
  catch (error) { throw makeError('manifest-network', error); }
  if (!response?.ok) throw makeError('manifest-http');

  let manifest;
  try { manifest = await response.json(); } catch (error) { throw makeError('manifest-invalid', error); }
  const latestVersion = String(manifest?.version || '');
  if (manifest?.schema !== 'dubhe-build-manifest/1' || !validVersion(latestVersion) || !manifest.files || typeof manifest.files !== 'object') {
    throw makeError('manifest-invalid');
  }

  const relation = compareBuildVersions(latestVersion, currentVersion);
  if (relation < 0) return { status: 'remote-behind', version: latestVersion };

  const cacheReady = await hasReadyCache(cachesImpl, scopeUrl, latestVersion);
  if (relation === 0 && cacheReady) return { status: 'current', version: latestVersion };
  if (relation > 0 && cacheReady) {
    try { onProgress({ phase: 'ready', version: latestVersion, completed: 1, total: 1 }); } catch { /* UI callbacks must not affect caching */ }
    return { status: 'cached', version: latestVersion };
  }
  try { onProgress({ phase: 'manifest', version: latestVersion, completed: 0, total: 0, reason: relation === 0 ? 'repair' : 'update' }); } catch { /* UI callbacks must not affect caching */ }

  const serviceWorker = navigatorImpl?.serviceWorker;
  if (!serviceWorker || typeof serviceWorker.getRegistration !== 'function') return { status: 'unsupported', version: latestVersion };

  let registration;
  try {
    registration = await serviceWorker.getRegistration(scopeUrl);
    if (!registration) {
      if (typeof serviceWorker.register !== 'function') return { status: 'unsupported', version: latestVersion };
      registration = await serviceWorker.register(new URL('sw.js', scopeUrl).href, { scope: scopeUrl, updateViaCache: 'none' });
    }
  } catch (error) { throw makeError('registration-failed', error); }
  if (!registration || (registration.scope && new URL(registration.scope).href !== scopeUrl)) throw makeError('registration-scope-mismatch');
  if (typeof registration.update !== 'function') throw makeError('registration-update-unavailable');

  return await new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const watched = new WeakSet();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      serviceWorker.removeEventListener?.('message', onMessage);
      registration.removeEventListener?.('updatefound', onUpdateFound);
      callback(value);
    };
    const onMessage = (event) => {
      const raw = event?.data;
      if (!raw || raw.type !== 'dubhe-cache-progress' || String(raw.version || '') !== latestVersion) return;
      const progress = safeProgress(raw);
      if (progress.phase === 'manifest') progress.reason = relation === 0 ? 'repair' : 'update';
      if (progress.phase === 'idle') return;
      try { onProgress(progress); } catch { /* rendering progress is best-effort */ }
      if (progress.phase === 'ready') finish(resolve, { status: 'updated', version: latestVersion, waiting: !!registration.waiting });
      else if (progress.phase === 'error') finish(reject, makeError('cache-install-failed'));
    };
    const requestProgress = (worker) => {
      if (!worker || typeof worker.postMessage !== 'function') return;
      try { worker.postMessage({ type: 'dubhe-cache-progress-request' }); } catch { /* worker may be shutting down */ }
    };
    const watchWorker = (worker) => {
      if (!worker || watched.has(worker)) return;
      watched.add(worker);
      worker.addEventListener?.('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') requestProgress(worker);
        else if (worker.state === 'redundant' && !settled) {
          // Give the worker's explicit install-error progress message a chance to arrive first.
          setTimeout(() => {
            if (!settled && worker.state === 'redundant') finish(reject, makeError('cache-install-failed'));
          }, 80);
        }
      });
      requestProgress(worker);
    };
    const onUpdateFound = () => watchWorker(registration.installing);
    timer = setTimeout(() => finish(reject, makeError('cache-update-timeout')), Math.max(1000, timeoutMs));

    serviceWorker.addEventListener?.('message', onMessage);
    registration.addEventListener?.('updatefound', onUpdateFound);
    watchWorker(registration.installing);
    watchWorker(registration.waiting);
    watchWorker(registration.active);

    Promise.resolve().then(() => registration.update()).then(async () => {
      if (settled) return;
      watchWorker(registration.installing);
      watchWorker(registration.waiting);
      requestProgress(registration.active);
      if (!registration.installing && !registration.waiting) {
        if (await hasReadyCache(cachesImpl, scopeUrl, latestVersion)) {
          finish(resolve, relation === 0 ? { status: 'current', version: latestVersion } : { status: 'cached', version: latestVersion });
        } else if (relation === 0 && registration.active) {
          try { registration.active.postMessage({ type: 'dubhe-cache-refresh-request', version: latestVersion }); }
          catch (error) { finish(reject, makeError('worker-update-failed', error)); }
        } else {
          finish(reject, makeError('no-worker-update'));
        }
      }
    }).catch(async (error) => {
      if (settled) return;
      if (await hasReadyCache(cachesImpl, scopeUrl, latestVersion)) finish(resolve, { status: 'cached', version: latestVersion });
      else finish(reject, makeError('worker-update-failed', error));
    });
  });
}
