// Shared, fail-closed network state. app.html installs the synchronous bootstrap
// before external resources; this module supplies the ES-module API and a fallback.
export function isNetworkOffline({ navigatorImpl = globalThis.navigator, gate = globalThis.__dubheOfflineNetworkGate } = {}) {
  return !!(gate && gate.offline) || navigatorImpl?.onLine === false;
}

export function isOffsiteHttpUrl(input, base = globalThis.location?.href || 'http://localhost/') {
  try {
    const raw = input && typeof input === 'object' && typeof input.url === 'string' ? input.url : String(input || '');
    const url = new URL(raw, base);
    const here = new URL(base);
    return /^https?:$/.test(url.protocol) && url.origin !== here.origin;
  } catch { return false; }
}

export function announceNetworkState() {
  const offline = isNetworkOffline();
  try {
    globalThis.navigator?.serviceWorker?.controller?.postMessage({ type: 'dubhe-network-state', offline });
  } catch { /* the page may not yet be controlled */ }
  return offline;
}

export function installOfflineNetworkFence() {
  const gate = globalThis.__dubheOfflineNetworkGate;
  if (gate && typeof gate.install === 'function') {
    gate.install();
    return gate;
  }
  if (globalThis.__dubheFallbackNetworkFenceInstalled) return gate || null;
  globalThis.__dubheFallbackNetworkFenceInstalled = true;
  if (typeof globalThis.fetch !== 'function') return gate || null;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = function offlineGuardedFetch(input, init) {
    if (isNetworkOffline() && isOffsiteHttpUrl(input)) {
      try { gate?.record?.(input, 'fetch'); } catch { /* diagnostics only */ }
      return Promise.reject(new TypeError('Offline mode blocks off-site network requests.'));
    }
    return originalFetch(input, init);
  };
  return gate || null;
}
