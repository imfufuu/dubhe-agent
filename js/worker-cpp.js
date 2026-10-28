import { compileAndRunCpp } from './local-cpp-runtime.js';

const DIST_PATH = new URL('../assets/vendor/cpp/browsercc/runtime/', import.meta.url).pathname;
const ASSET_TYPES = Object.freeze({
  'clang.wasm': 'application/wasm',
  'lld.wasm': 'application/wasm',
  'sysroot.tar': 'application/x-tar',
});
const networkFetch = self.fetch.bind(self);
// 压缩后的体积兜底值（服务器未返回 Content-Length 时用于估算进度）
const FALLBACK_BYTES = Object.freeze({ 'clang.wasm': 15010669, 'lld.wasm': 8699033, 'sysroot.tar': 5677607 });
const downloadProgress = new Map();
let lastProgressPost = 0;
function reportDownload(name, loaded, total) {
  downloadProgress.set(name, { loaded, total: total || FALLBACK_BYTES[name] || 0 });
  const now = Date.now();
  const finished = loaded >= (total || FALLBACK_BYTES[name] || 0);
  if (!finished && now - lastProgressPost < 120) return;
  lastProgressPost = now;
  let sumLoaded = 0, sumTotal = 0;
  for (const key of Object.keys(FALLBACK_BYTES)) {
    const entry = downloadProgress.get(key) || { loaded: 0, total: FALLBACK_BYTES[key] };
    sumLoaded += entry.loaded;
    sumTotal += entry.total;
  }
  self.postMessage({ __progress: { phase: 'loading-assets', loaded: sumLoaded, total: sumTotal } });
}
// 边读边计数（压缩字节），不改变数据内容
function countBytes(body, onBytes) {
  let loaded = 0;
  return body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      loaded += chunk?.byteLength || 0;
      onBytes(loaded);
      controller.enqueue(chunk);
    },
  }));
}

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
  const declared = Number(response.headers.get('content-length'));
  const total = Number.isFinite(declared) && declared > 0 ? declared : FALLBACK_BYTES[name];
  let body = response.body && countBytes(response.body, (loaded) => reportDownload(name, loaded, total));
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
