import {
  OFFLINE_MODEL_CONTEXT_SIZE,
  OFFLINE_MODEL_MAX_OUTPUT_TOKENS,
  OFFLINE_MODEL_SHA256,
  OFFLINE_MODEL_SIZE_BYTES,
  OFFLINE_MODEL_URL,
  OFFLINE_MODEL_REVISION,
  OFFLINE_MODEL_ID,
  WLLAMA_VERSION,
  formatDownloadBytes,
} from './offline-model-config.js';
import { isNetworkOffline } from './offline-network.js';

let enginePromise = null;
let engineInstance = null;
let activeOfflineRuns = 0;

function abortError() {
  if (typeof DOMException === 'function') return new DOMException('Aborted', 'AbortError');
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

export function supportsOfflineModelStorage({ navigatorImpl = globalThis.navigator, secureContext = globalThis.isSecureContext } = {}) {
  return secureContext !== false && typeof navigatorImpl?.storage?.getDirectory === 'function';
}

async function createOfflineEngine() {
  if (!supportsOfflineModelStorage()) throw new Error('本地模型需要支持 OPFS 的安全浏览器环境（HTTPS 或 localhost）。');
  const entryUrl = new URL(`../assets/vendor/wllama/wllama-${WLLAMA_VERSION}.js`, import.meta.url).href;
  const wasmUrl = new URL(`../assets/vendor/wllama/wllama-${WLLAMA_VERSION}.wasm`, import.meta.url).href;
  const { Wllama, LoggerWithoutDebug } = await import(entryUrl);
  const runtime = new Wllama({ default: wasmUrl }, {
    allowOffline: true,
    parallelDownloads: 1,
    logger: LoggerWithoutDebug,
  });
  // Wllama 3.8.1 otherwise points its compatibility worker/WASM files at jsDelivr.
  // No model lookup, load, or inference may use the default remote compatibility path.
  runtime.setCompat(null);
  return runtime;
}

export async function getOfflineModelEngine() {
  if (engineInstance) return engineInstance;
  enginePromise ||= createOfflineEngine().then((engine) => {
    engineInstance = engine;
    return engine;
  }).catch((error) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
}

export async function findCachedOfflineModel(engine) {
  if (!engine?.modelManager || typeof engine.modelManager.getModels !== 'function') return null;
  // getModels() inspects OPFS only. It does not query Hugging Face or download anything.
  const models = await engine.modelManager.getModels();
  return models.find((model) => model && model.url === OFFLINE_MODEL_URL && model.validate?.() === 'valid') || null;
}

export async function getOfflineModelStatus({ engineProvider = getOfflineModelEngine, storage = globalThis.navigator?.storage } = {}) {
  if (!supportsOfflineModelStorage({ navigatorImpl: { storage }, secureContext: globalThis.isSecureContext })) {
    return { supported: false, available: false, size: 0, reason: 'storage-unavailable' };
  }
  try {
    const engine = await engineProvider();
    const model = await findCachedOfflineModel(engine);
    return { supported: true, available: !!model, size: model ? Math.max(0, Number(model.size) || 0) : 0, model: model || null };
  } catch (error) {
    return { supported: true, available: false, size: 0, error };
  }
}

export async function syncOfflineModelAvailability(store, { notify = true } = {}) {
  const status = await getOfflineModelStatus();
  if (store?.state) {
    store.state.offlineModelChecked = true;
    store.state.offlineModelAvailable = status.available;
    store.state.offlineModelStorageSupported = status.supported;
    store.state.offlineModelStatusError = status.error ? String(status.error.message || status.error).slice(0, 180) : '';
    if (notify && typeof store.notify === 'function') store.notify();
  }
  try { globalThis.dispatchEvent?.(new CustomEvent('dubhe:offline-model-status', { detail: status })); } catch { /* non-browser tests */ }
  return status;
}

async function discardUnverifiedOfflineModel(engine) {
  try { await engine?.modelManager?.cacheManager?.delete?.(OFFLINE_MODEL_URL); } catch { /* best-effort removal of partial or invalid cache */ }
}

async function checkStorageSpace(storage) {
  try { await storage.persist?.(); } catch { /* browser may deny persistent storage without a prompt */ }
  try {
    const estimate = await storage.estimate?.();
    const quota = Number(estimate?.quota) || 0;
    const usage = Number(estimate?.usage) || 0;
    const free = quota - usage;
    if (quota > 0 && free < OFFLINE_MODEL_SIZE_BYTES * 1.08) {
      throw new Error(`可用浏览器存储不足：模型约需 ${formatDownloadBytes(OFFLINE_MODEL_SIZE_BYTES)}，当前估算剩余 ${formatDownloadBytes(Math.max(0, free))}。`);
    }
  } catch (error) {
    if (error instanceof Error && /存储不足/.test(error.message)) throw error;
    // Some browsers do not expose an estimate; OPFS will report quota failures itself.
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
class StreamingSha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    this.block = new Uint8Array(64);
    this.blockLength = 0;
    this.totalBytes = 0n;
    this.words = new Uint32Array(64);
  }
  update(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.totalBytes += BigInt(bytes.byteLength);
    let offset = 0;
    if (this.blockLength) {
      const take = Math.min(64 - this.blockLength, bytes.length);
      this.block.set(bytes.subarray(0, take), this.blockLength);
      this.blockLength += take; offset += take;
      if (this.blockLength === 64) { this.compress(this.block); this.blockLength = 0; }
    }
    while (offset + 64 <= bytes.length) { this.compress(bytes.subarray(offset, offset + 64)); offset += 64; }
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLength = bytes.length - offset;
    }
  }
  compress(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 64);
    const w = this.words;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = this.h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const v = [a,b,c,d,e,f,g,h];
    for (let i = 0; i < 8; i++) this.h[i] = (this.h[i] + v[i]) >>> 0;
  }
  digestHex() {
    const bitLength = this.totalBytes * 8n;
    const paddedLength = this.blockLength < 56 ? 64 : 128;
    const tail = new Uint8Array(paddedLength);
    tail.set(this.block.subarray(0, this.blockLength));
    tail[this.blockLength] = 0x80;
    new DataView(tail.buffer).setBigUint64(paddedLength - 8, bitLength, false);
    for (let offset = 0; offset < paddedLength; offset += 64) this.compress(tail.subarray(offset, offset + 64));
    return [...this.h].map((value) => value.toString(16).padStart(8, '0')).join('');
  }
}

export async function sha256Blob(blob, { signal, onProgress = () => {}, chunkBytes = 1024 * 1024 } = {}) {
  if (!blob || typeof blob.stream !== 'function') throw new Error('本地模型 Blob 不支持流式读取。');
  const hash = new StreamingSha256();
  const total = Math.max(0, Number(blob.size) || 0);
  let loaded = 0;
  const reader = blob.stream().getReader();
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      loaded += value.byteLength;
      onProgress({ loaded, total, phase: 'verify' });
    }
  } finally { try { await reader.cancel(); } catch { /* stream already closed */ } }
  if (loaded !== total) throw new Error(`本地文件长度不匹配：读取 ${loaded} / ${total} 字节。`);
  return hash.digestHex();
}

export async function verifyOfflineModelIntegrity(model, { signal, onProgress = () => {} } = {}) {
  if (!model || model.url !== OFFLINE_MODEL_URL || model.validate?.() !== 'valid') return { ok: false, reason: 'invalid-model' };
  const blobs = await model.open();
  const size = blobs.reduce((sum, blob) => sum + (Number(blob.size) || 0), 0);
  if (size !== OFFLINE_MODEL_SIZE_BYTES) return { ok: false, reason: 'size-mismatch', size };
  let loaded = 0;
  const hash = new StreamingSha256();
  for (const blob of blobs) {
    if (!blob || typeof blob.stream !== 'function') return { ok: false, reason: 'stream-unavailable', size };
    const reader = blob.stream().getReader();
    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        loaded += value.byteLength;
        onProgress({ loaded, total: size, phase: 'verify' });
      }
    } finally { try { await reader.cancel(); } catch { /* stream already closed */ } }
  }
  if (loaded !== size) return { ok: false, reason: 'size-mismatch', size: loaded };
  const actual = hash.digestHex();
  return { ok: actual === OFFLINE_MODEL_SHA256, actual, expected: OFFLINE_MODEL_SHA256, size };
}

export async function downloadOfflineModel({ signal, onProgress = () => {}, engineProvider = getOfflineModelEngine, verifyIntegrity = verifyOfflineModelIntegrity } = {}) {
  if (isNetworkOffline()) throw new Error('当前处于离线状态；模型不会自动下载。恢复网络后再手动点击“下载模型”。');
  throwIfAborted(signal);
  if (!supportsOfflineModelStorage()) throw new Error('当前浏览器不支持本地模型存储（OPFS），请使用 HTTPS / localhost 下的现代浏览器。');
  const engine = await engineProvider();
  const cached = await findCachedOfflineModel(engine);
  if (cached) {
    onProgress({ loaded: cached.size, total: cached.size, phase: 'ready' });
    return cached;
  }
  await discardUnverifiedOfflineModel(engine);
  if (isNetworkOffline()) throw new Error('当前处于离线状态；模型不会自动下载。恢复网络后再手动点击“下载模型”。');
  await checkStorageSpace(globalThis.navigator.storage);
  throwIfAborted(signal);
  onProgress({ loaded: 0, total: OFFLINE_MODEL_SIZE_BYTES, phase: 'download' });
  // This is the only download entry point. It is called only from the explicit settings button.
  // A pinned resolve URL is used; no mutable main branch or Hub model-discovery API is queried.
  let model;
  try {
    model = await engine.modelManager.downloadModel(OFFLINE_MODEL_URL, {
      signal,
      progressCallback: (progress = {}) => onProgress({
        loaded: Math.max(0, Number(progress.loaded) || 0),
        total: Math.max(0, Number(progress.total) || OFFLINE_MODEL_SIZE_BYTES),
        phase: 'download',
      }),
      metadataAdditional: { revision: OFFLINE_MODEL_REVISION, sha256: OFFLINE_MODEL_SHA256 },
    });
  } catch (error) {
    await discardUnverifiedOfflineModel(engine);
    throw error;
  }
  const cachedModel = await findCachedOfflineModel(engine);
  if (!cachedModel || cachedModel.size !== OFFLINE_MODEL_SIZE_BYTES) {
    await discardUnverifiedOfflineModel(engine);
    throw new Error('模型下载未通过本地缓存完整性检查；请重试或清理未完成下载。');
  }
  let integrity;
  try {
    integrity = await verifyIntegrity(cachedModel, { signal, onProgress });
  } catch (error) {
    if (error?.name === 'AbortError') {
      try { await cachedModel.remove(); } catch { /* remove a partial/unverified install best-effort */ }
    }
    throw error;
  }
  if (!integrity.ok) {
    try { await cachedModel.remove(); } catch { /* avoid reusing a bad model when possible */ }
    throw new Error(integrity.reason === 'size-mismatch'
      ? '模型下载后文件大小不匹配，未安装；请重新下载。'
      : `模型 SHA-256 校验失败，未安装。期望 ${OFFLINE_MODEL_SHA256.slice(0, 12)}…，实际 ${(integrity.actual || '不可用').slice(0, 12)}…`);
  }
  onProgress({ loaded: cachedModel.size, total: cachedModel.size, phase: 'ready' });
  return model || cachedModel;
}

export async function removeOfflineModel({ engineProvider = getOfflineModelEngine } = {}) {
  if (activeOfflineRuns > 0) throw new Error('本地模型正在推理；请等待当前回合结束后再移除。');
  const engine = await engineProvider();
  if (typeof engine.isModelLoaded === 'function' && engine.isModelLoaded()) await engine.exit?.();
  const models = await engine.modelManager.getModels({ includeInvalid: true });
  const model = models.find((entry) => entry && entry.url === OFFLINE_MODEL_URL);
  if (model) await model.remove();
  engineInstance = null;
  enginePromise = null;
  return { removed: !!model };
}

export async function streamOfflineModel({
  messages,
  tools = [],
  signal,
  temperature = 0.7,
  maxTokens = OFFLINE_MODEL_MAX_OUTPUT_TOKENS,
  onChunk = () => {},
} = {}, { engineProvider = getOfflineModelEngine, cachedModelProvider = findCachedOfflineModel } = {}) {
  activeOfflineRuns++;
  try {
    throwIfAborted(signal);
    const engine = await engineProvider();
    const model = await cachedModelProvider(engine);
    if (!model) throw new Error('本地模型尚未安装。请联网后在“设置 → 离线本地模型”中手动下载；本次推理没有尝试联网。');
    throwIfAborted(signal);
    if (typeof engine.isModelLoaded !== 'function' || !engine.isModelLoaded()) {
      // Pass the cached Model object, never a URL: Wllama's URL loader may download on a cache miss.
      await engine.loadModel(model, {
        n_ctx: OFFLINE_MODEL_CONTEXT_SIZE,
        n_batch: 512,
        n_threads: Math.max(1, Math.min(4, Math.floor(Number(globalThis.navigator?.hardwareConcurrency) / 2) || 2)),
        warmup: false,
      });
    }
    throwIfAborted(signal);
    const availableTools = Array.isArray(tools) && tools.length ? tools : undefined;
    const stream = await engine.createChatCompletion({
      model: OFFLINE_MODEL_ID,
      messages: Array.isArray(messages) ? messages : [],
      ...(availableTools ? { tools: availableTools, tool_choice: 'auto' } : {}),
      stream: true,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.7,
      top_p: 0.9,
      max_tokens: Math.max(1, Math.min(OFFLINE_MODEL_MAX_OUTPUT_TOKENS, Number(maxTokens) || OFFLINE_MODEL_MAX_OUTPUT_TOKENS)),
      abortSignal: signal,
    });
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') throw new Error('本地推理运行时未返回可读流。');
    for await (const chunk of stream) {
      throwIfAborted(signal);
      onChunk(chunk);
    }
  } finally {
    activeOfflineRuns = Math.max(0, activeOfflineRuns - 1);
  }
}

export function formatOfflineDownloadProgress({ loaded = 0, total = OFFLINE_MODEL_SIZE_BYTES } = {}) {
  const safeTotal = Math.max(1, Number(total) || OFFLINE_MODEL_SIZE_BYTES);
  const safeLoaded = Math.max(0, Math.min(safeTotal, Number(loaded) || 0));
  return {
    loaded: safeLoaded,
    total: safeTotal,
    percent: Math.max(0, Math.min(100, Math.round((safeLoaded / safeTotal) * 100))),
    loadedText: formatDownloadBytes(safeLoaded),
    totalText: formatDownloadBytes(safeTotal),
  };
}
