/* Synchronous offline gate. Loaded in every entry page before fonts, modules or third-party resources. */
(() => {
  const gate = globalThis.__dubheOfflineNetworkGate || {
    offline: false,
    cspLocked: false,
    reloadRequired: false,
    blockedRequests: [],
    activeFetchControllers: new Set(),
    installed: false,
    record(input, kind = 'network') {
      let path = String(input || '');
      try { const u = new URL(input && input.url ? input.url : input, location.href); path = `${u.origin}${u.pathname}`; } catch { /* retain safe string */ }
      this.blockedRequests.push({ kind, path, at: Date.now() });
      if (this.blockedRequests.length > 100) this.blockedRequests.shift();
    },
  };
  globalThis.__dubheOfflineNetworkGate = gate;

  const isOffsiteHttp = (input) => {
    try {
      const raw = input && typeof input === 'object' && input.url ? input.url : String(input || '');
      const u = new URL(raw, location.href);
      return /^https?:$/.test(u.protocol) && u.origin !== location.origin;
    } catch { return false; }
  };
  const isOffline = () => gate.offline || navigator.onLine === false;
  const dispatchState = (extra = {}) => {
    if (isOffline()) for (const controller of gate.activeFetchControllers || []) controller.abort();
    try { window.dispatchEvent(new CustomEvent('dubhe:network-state', { detail: { offline: isOffline(), reloadRequired: gate.reloadRequired, ...extra } })); } catch { /* startup fallback */ }
    try { navigator.serviceWorker?.controller?.postMessage({ type: 'dubhe-network-state', offline: isOffline() }); } catch { /* not controlled yet */ }
  };
  const enforceStrictCsp = () => {
    if (document.querySelector('meta[data-dubhe-offline-csp]')) return;
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.dataset.dubheOfflineCsp = '1';
    policy.content = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-KWAlpbtB4R45zBOqEtLM+90JdLvHqoOyoaQRSGS6uBs=' 'sha256-LjPqEsoSyXosQVrr222sSixEHpbDYV2tn3a1TzWcXpg='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    document.head.appendChild(policy);
    gate.cspLocked = true;
  };
  const install = () => {
    if (gate.installed) return;
    gate.installed = true;
    const nativeFetch = globalThis.fetch;
    if (typeof nativeFetch === 'function' && !globalThis.__dubheOfflineFetchWrapped) {
      globalThis.__dubheOfflineFetchWrapped = true;
      globalThis.fetch = function offlineGuardedFetch(input, init) {
        const requestInit = init && typeof init === 'object' ? init : {};
        if (isOffline() && isOffsiteHttp(input)) {
          gate.record(input, 'fetch');
          return Promise.reject(new TypeError('Offline mode blocks off-site network requests.'));
        }
        const controller = new AbortController();
        const signals = [requestInit.signal, input && typeof input === 'object' ? input.signal : null].filter(Boolean);
        const cleanup = [];
        for (const signal of signals) {
          if (signal.aborted) controller.abort();
          else {
            const abort = () => controller.abort();
            signal.addEventListener('abort', abort, { once: true });
            cleanup.push(() => signal.removeEventListener('abort', abort));
          }
        }
        gate.activeFetchControllers.add(controller);
        let promise;
        try { promise = nativeFetch.call(globalThis, input, { ...requestInit, signal: controller.signal }); }
        catch (error) {
          gate.activeFetchControllers.delete(controller);
          for (const remove of cleanup) remove();
          throw error;
        }
        return Promise.resolve(promise).finally(() => {
          gate.activeFetchControllers.delete(controller);
          for (const remove of cleanup) remove();
        });
      };
    }
    const NativeWebSocket = globalThis.WebSocket;
    if (typeof NativeWebSocket === 'function' && !globalThis.__dubheOfflineWebSocketWrapped) {
      globalThis.__dubheOfflineWebSocketWrapped = true;
      globalThis.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args, newTarget) {
          if (isOffline()) {
            gate.record(args[0], 'websocket');
            throw new DOMException('Offline mode blocks WebSocket connections.', 'NetworkError');
          }
          return Reflect.construct(target, args, newTarget);
        },
      });
    }
    const NativeXHR = globalThis.XMLHttpRequest;
    if (typeof NativeXHR === 'function' && !globalThis.__dubheOfflineXhrWrapped) {
      globalThis.__dubheOfflineXhrWrapped = true;
      const nativeOpen = NativeXHR.prototype.open;
      NativeXHR.prototype.open = function offlineGuardedXhrOpen(method, url, ...rest) {
        if (isOffline()) {
          gate.record(url, 'xhr');
          throw new DOMException('Offline mode blocks XMLHttpRequest.', 'NetworkError');
        }
        return nativeOpen.call(this, method, url, ...rest);
      };
    }
    if (!globalThis.__dubheOfflineNavigationWrapped) {
      globalThis.__dubheOfflineNavigationWrapped = true;
      document.addEventListener('click', (event) => {
        const anchor = event.target?.closest?.('a[href]');
        if (!anchor || !isOffline() || !isOffsiteHttp(anchor.href)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        gate.record(anchor.href, 'navigation');
        try { window.dispatchEvent(new CustomEvent('dubhe:offline-navigation-blocked', { detail: { href: anchor.href } })); } catch { /* diagnostic only */ }
      }, true);
      const nativeOpen = globalThis.open;
      if (typeof nativeOpen === 'function') globalThis.open = function offlineGuardedOpen(url, ...args) {
        if (isOffline() && isOffsiteHttp(url)) { gate.record(url, 'navigation'); return null; }
        return nativeOpen.call(this, url, ...args);
      };
    }
    const NativeEventSource = globalThis.EventSource;
    if (typeof NativeEventSource === 'function' && !globalThis.__dubheOfflineEventSourceWrapped) {
      globalThis.__dubheOfflineEventSourceWrapped = true;
      globalThis.EventSource = new Proxy(NativeEventSource, {
        construct(target, args, newTarget) {
          if (isOffline()) {
            gate.record(args[0], 'eventsource');
            throw new DOMException('Offline mode blocks EventSource.', 'NetworkError');
          }
          return Reflect.construct(target, args, newTarget);
        },
      });
    }
    try {
      const proto = Object.getPrototypeOf(navigator);
      const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'sendBeacon');
      if (descriptor?.value && !globalThis.__dubheOfflineBeaconWrapped) {
        globalThis.__dubheOfflineBeaconWrapped = true;
        proto.sendBeacon = function offlineGuardedBeacon(url, ...args) {
          if (isOffline()) {
            gate.record(url, 'beacon');
            return false;
          }
          return descriptor.value.call(this, url, ...args);
        };
      }
    } catch { /* beacon may be non-overridable */ }
  };
  gate.install = install;
  install();

  const enterOffline = (initial = false) => {
    gate.offline = true;
    gate.reloadRequired = gate.cspLocked || initial;
    enforceStrictCsp();
    dispatchState({ initial });
  };
  const enterOnline = () => {
    if (gate.cspLocked) {
      // CSP cannot be relaxed for an already-open document. Stay local-only until a fresh online reload.
      gate.offline = true;
      gate.reloadRequired = true;
      dispatchState({ initial: false, reloadRequired: true });
      return;
    }
    gate.offline = false;
    gate.reloadRequired = false;
    dispatchState({ initial: false });
  };
  if (navigator.onLine === false) enterOffline(true);
  window.addEventListener('offline', () => enterOffline(false));
  window.addEventListener('online', enterOnline);
})();
