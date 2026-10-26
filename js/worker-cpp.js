import { compileAndRunCpp } from './local-cpp-runtime.js';

const DIST_PATH = new URL('../assets/vendor/cpp/browsercc/runtime/', import.meta.url).pathname;
const ASSET_TYPES = Object.freeze({
  'clang.wasm': 'application/wasm',
  'lld.wasm': 'application/wasm',
  'sysroot.tar': 'application/x-tar',
});
const networkFetch = self.fetch.bind(self);

// Compiler workers may fetch only the pinned, same-origin compiler assets.
// In particular, no source, stdin, files, or compiler diagnostics can be sent off-device.
self.fetch = async (input, init = {}) => {
  const rawUrl = input instanceof Request ? input.url : String(input);
  const url = new URL(rawUrl, self.location.href);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(DIST_PATH)) {
    throw new TypeError('Local C++ worker blocked a non-local network request.');
  }
  const name = url.pathname.slice(DIST_PATH.length);
  const mime = ASSET_TYPES[name];
  if (!mime) throw new TypeError('Local C++ worker requested an unapproved asset.');

  const compressedUrl = new URL(`${name}.gz`, url);
  const response = await networkFetch(compressedUrl, { ...init, credentials: 'omit' });
  if (!response.ok) return response;
  const encoding = String(response.headers.get('content-encoding') || '').toLowerCase();
  let body = response.body;
  if (!encoding.includes('gzip')) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('此浏览器不支持 gzip 解压，无法加载本地 C++ 工具链。');
    }
    body = body.pipeThrough(new DecompressionStream('gzip'));
  }
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('content-type', mime);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
};

self.onmessage = async (event) => {
  try {
    const result = await compileAndRunCpp(event.data || {}, {
      onPhase: (phase) => self.postMessage({ __phase: phase }),
    });
    self.postMessage(result);
  } catch (error) {
    self.postMessage({
      ok: false,
      logs: [],
      error: { message: `本地 C++ Worker 失败：${String(error?.message || error)}` },
    });
  }
};

self.postMessage({ __dubheReady: 'cpp-runtime-1' });
