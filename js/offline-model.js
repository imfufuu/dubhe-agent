import {
  MAX_SINGLE_GGUF_BYTES,
  OFFLINE_MODEL_CONTEXT_SIZE,
  OFFLINE_MODEL_ID,
  OFFLINE_MODEL_MAX_OUTPUT_TOKENS,
  WLLAMA_VERSION,
} from './offline-model-config.js';
import { estimateGGUFMemory, readDeviceMemoryGB, readGGUFMetadata } from './gguf.js';

const MODEL_METADATA_FILE = 'dubhe-local-model.json';
const MODEL_FILE_PREFIX = 'dubhe-local-model-';
const MODEL_SCHEMA_VERSION = 1;
const STORAGE_MARGIN_BYTES = 64 * 1024 ** 2;
const GGUF_MAGIC = [0x47, 0x47, 0x55, 0x46];

let enginePromise = null;
let engineInstance = null;
let loadedModelKey = '';
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

function isNotFoundError(error) {
  return error?.name === 'NotFoundError' || /not found|does not exist/i.test(String(error?.message || ''));
}

function safeFileName(value) {
  const name = String(value || '');
  return name.startsWith(MODEL_FILE_PREFIX) && name.endsWith('.gguf') && !name.includes('/') && !name.includes('\\')
    ? name
    : '';
}

function createStoredFileName() {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${MODEL_FILE_PREFIX}${id}.gguf`;
}

function notifyProgress(onProgress, loaded, total) {
  try {
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeLoaded = Math.max(0, Math.min(safeTotal, Number(loaded) || 0));
    onProgress({ loaded: safeLoaded, total: safeTotal, percent: Math.round(safeLoaded / safeTotal * 100), phase: 'copy' });
  } catch { /* Progress UI must not interrupt local file import. */ }
}

export function supportsOfflineModelStorage({ navigatorImpl = globalThis.navigator, secureContext = globalThis.isSecureContext } = {}) {
  return secureContext !== false && typeof navigatorImpl?.storage?.getDirectory === 'function';
}

async function getRootDirectory(storage = globalThis.navigator?.storage) {
  if (!supportsOfflineModelStorage({ navigatorImpl: { storage }, secureContext: globalThis.isSecureContext })) {
    throw new Error('本地 GGUF 需要支持 OPFS 的安全浏览器环境（HTTPS 或 localhost）。');
  }
  return storage.getDirectory();
}

async function readStoredMetadata(root) {
  const handle = await root.getFileHandle(MODEL_METADATA_FILE);
  const file = await handle.getFile();
  const parsed = JSON.parse(await file.text());
  if (!parsed || parsed.schemaVersion !== MODEL_SCHEMA_VERSION || !safeFileName(parsed.fileName)) {
    throw new Error('本地 GGUF 索引损坏；请重新选择模型文件。');
  }
  const fileSize = Number(parsed.fileSize);
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > MAX_SINGLE_GGUF_BYTES) {
    throw new Error('本地 GGUF 索引中的文件大小无效。');
  }
  return parsed;
}

async function hasGGUFMagic(file) {
  if (!file || file.size < 4) return false;
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return GGUF_MAGIC.every((value, index) => bytes[index] === value);
}

export async function getOfflineModelStatus({ storage = globalThis.navigator?.storage, secureContext = globalThis.isSecureContext } = {}) {
  const supported = supportsOfflineModelStorage({ navigatorImpl: { storage }, secureContext });
  if (!supported) return { supported: false, available: false, size: 0, metadata: null, reason: 'storage-unavailable' };
  try {
    const root = await storage.getDirectory();
    const metadata = await readStoredMetadata(root);
    const handle = await root.getFileHandle(metadata.fileName);
    const file = await handle.getFile();
    if (file.size !== metadata.fileSize) throw new Error('本地 GGUF 文件大小与索引不符；请重新选择模型文件。');
    if (!await hasGGUFMagic(file)) throw new Error('本地模型文件头无效；请重新选择 GGUF 文件。');
    return { supported: true, available: true, size: file.size, metadata };
  } catch (error) {
    if (isNotFoundError(error)) return { supported: true, available: false, size: 0, metadata: null };
    return { supported: true, available: false, size: 0, metadata: null, error };
  }
}

export async function syncOfflineModelAvailability(store, { notify = true, storage = globalThis.navigator?.storage } = {}) {
  const status = await getOfflineModelStatus({ storage });
  if (store?.state) {
    store.state.offlineModelChecked = true;
    store.state.offlineModelAvailable = status.available === true;
    store.state.offlineModelStorageSupported = status.supported === true;
    store.state.offlineModelMetadata = status.available ? status.metadata : null;
    store.state.offlineModelStatusError = status.error ? String(status.error.message || status.error).slice(0, 180) : '';
    if (notify && typeof store.notify === 'function') store.notify();
  }
  try { globalThis.dispatchEvent?.(new CustomEvent('dubhe:offline-model-status', { detail: status })); } catch { /* non-browser tests */ }
  return status;
}

async function checkStorageSpace(storage, requiredBytes) {
  try { await storage.persist?.(); } catch { /* Browser may decline persistent storage without affecting import. */ }
  try {
    const estimate = await storage.estimate?.();
    const quota = Number(estimate?.quota) || 0;
    const usage = Number(estimate?.usage) || 0;
    if (quota > 0 && quota - usage < requiredBytes + STORAGE_MARGIN_BYTES) {
      const free = Math.max(0, quota - usage);
      throw new Error(`浏览器本地存储空间可能不足：本次导入需要约 ${(requiredBytes / 1024 ** 3).toFixed(2)} GiB，估算剩余 ${(free / 1024 ** 3).toFixed(2)} GiB。请释放空间后重试。`);
    }
  } catch (error) {
    if (error instanceof Error && /本地存储空间可能不足/.test(error.message)) throw error;
    // Some browsers do not expose quota estimates; the OPFS write will report a quota error if needed.
  }
}

async function writeBlobToOPFS(root, targetName, blob, { signal, onProgress = () => {} } = {}) {
  const handle = await root.getFileHandle(targetName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  const writer = writable.getWriter();
  const reader = blob.stream().getReader();
  let loaded = 0;
  notifyProgress(onProgress, 0, blob.size);
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      loaded += value.byteLength;
      notifyProgress(onProgress, loaded, blob.size);
    }
    throwIfAborted(signal);
    if (loaded !== blob.size) throw new Error(`GGUF 文件复制不完整：${loaded} / ${blob.size} 字节。`);
    await writer.close();
    return await handle.getFile();
  } catch (error) {
    try { await reader.cancel(error); } catch { /* The stream may already be closed. */ }
    try { await writer.abort(error); } catch { /* Best-effort rollback of the OPFS temporary write. */ }
    try { await root.removeEntry(targetName); } catch { /* Keep the original model/index intact. */ }
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* Ignore a released reader. */ }
    try { writer.releaseLock(); } catch { /* Ignore a released writer. */ }
  }
}

async function writeJsonToOPFS(root, fileName, value) {
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  const writer = writable.getWriter();
  try {
    await writer.write(JSON.stringify(value));
    await writer.close();
  } catch (error) {
    try { await writer.abort(error); } catch { /* Best-effort discard. */ }
    throw error;
  } finally {
    try { writer.releaseLock(); } catch { /* Ignore a released writer. */ }
  }
}

function nullableFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function serializableMetadata(parsed, file, storedFileName, memoryEstimate) {
  return {
    schemaVersion: MODEL_SCHEMA_VERSION,
    fileName: storedFileName,
    sourceName: String(file.name || parsed.fileName || 'model.gguf').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240),
    displayName: String(parsed.displayName || file.name || '本地 GGUF').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160),
    architecture: String(parsed.architecture || '').slice(0, 80),
    parameterCount: Number.isSafeInteger(parsed.parameterCount) && parsed.parameterCount > 0 ? parsed.parameterCount : null,
    parameterCountSource: String(parsed.parameterCountSource || 'unknown').slice(0, 40),
    quantization: String(parsed.quantization || '').slice(0, 40),
    contextLength: nullableFiniteNumber(parsed.contextLength),
    blockCount: nullableFiniteNumber(parsed.blockCount),
    embeddingLength: nullableFiniteNumber(parsed.embeddingLength),
    attentionHeads: nullableFiniteNumber(parsed.attentionHeads),
    kvAttentionHeads: nullableFiniteNumber(parsed.kvAttentionHeads),
    keyLength: nullableFiniteNumber(parsed.keyLength),
    valueLength: nullableFiniteNumber(parsed.valueLength),
    fileSize: Number(file.size),
    importedAt: Date.now(),
    memoryEstimate: {
      risk: memoryEstimate?.risk || 'unknown',
      estimatedWorkingSetBytes: Number(memoryEstimate?.estimatedWorkingSetBytes) || null,
      systemMemoryGB: Number(memoryEstimate?.systemMemoryGB) || null,
    },
  };
}

export async function importOfflineModel(file, {
  signal,
  onProgress = () => {},
  storage = globalThis.navigator?.storage,
  parsedMetadata = null,
  memoryEstimate = null,
  fileNameFactory = createStoredFileName,
  metadataReader = readGGUFMetadata,
} = {}) {
  throwIfAborted(signal);
  if (!file || typeof file.stream !== 'function' || !Number.isSafeInteger(Number(file.size)) || file.size <= 0) {
    throw new Error('请选择有效的本地 GGUF 文件。');
  }
  if (!/\.gguf$/i.test(String(file.name || ''))) throw new Error('当前只接受单文件 .gguf；分片模型暂不支持。');
  if (file.size > MAX_SINGLE_GGUF_BYTES) throw new Error('单个 GGUF 文件需小于 2 GiB；超大或分片模型当前不支持。');
  const parsed = parsedMetadata || await metadataReader(file, { fileName: file.name || '' });
  if (parsed?.format !== 'gguf') throw new Error('没有识别到有效的 GGUF 元数据。');
  if (Number(parsed.fileSize) !== Number(file.size)) throw new Error('GGUF 元数据与所选文件大小不一致；请重新选择文件。');
  const estimate = memoryEstimate || estimateGGUFMemory({
    fileBytes: file.size,
    metadata: parsed,
    deviceMemoryGB: readDeviceMemoryGB(),
    contextSize: OFFLINE_MODEL_CONTEXT_SIZE,
  });
  const root = await getRootDirectory(storage);
  await checkStorageSpace(storage, file.size);
  throwIfAborted(signal);

  const oldStatus = await getOfflineModelStatus({ storage });
  const storedFileName = String(fileNameFactory());
  if (!safeFileName(storedFileName)) throw new Error('生成的本地模型文件名无效。');
  let committed = false;
  try {
    const storedFile = await writeBlobToOPFS(root, storedFileName, file, { signal, onProgress });
    throwIfAborted(signal);
    if (storedFile.size !== file.size || !await hasGGUFMagic(storedFile)) throw new Error('保存后的 GGUF 校验失败；原有模型未更改。');
    const metadata = serializableMetadata(parsed, file, storedFileName, estimate);
    await writeJsonToOPFS(root, MODEL_METADATA_FILE, metadata);
    committed = true;
    if (oldStatus.metadata?.fileName && oldStatus.metadata.fileName !== storedFileName) {
      try { await root.removeEntry(oldStatus.metadata.fileName); } catch { /* New metadata is already committed; stale-file cleanup is best effort. */ }
    }
    return await getOfflineModelStatus({ storage });
  } catch (error) {
    if (!committed) {
      try { await root.removeEntry(storedFileName); } catch { /* Keep previous index/model intact. */ }
    }
    throw error;
  }
}

export async function getOfflineModelFile({ storage = globalThis.navigator?.storage } = {}) {
  const status = await getOfflineModelStatus({ storage });
  if (!status.available) {
    if (status.error) throw status.error;
    throw new Error('尚未选择本地 GGUF。请前往“设置 → 离线本地模型”选择文件；本次推理没有尝试联网。');
  }
  const root = await storage.getDirectory();
  const handle = await root.getFileHandle(status.metadata.fileName);
  return { file: await handle.getFile(), metadata: status.metadata };
}

export async function removeOfflineModel({ storage = globalThis.navigator?.storage } = {}) {
  if (activeOfflineRuns > 0) throw new Error('本地模型正在推理；请等待当前回合结束后再移除。');
  if (engineInstance?.isModelLoaded?.()) await engineInstance.exit?.();
  loadedModelKey = '';
  if (!supportsOfflineModelStorage({ navigatorImpl: { storage }, secureContext: globalThis.isSecureContext })) {
    return { removed: false, supported: false };
  }
  const root = await storage.getDirectory();
  let metadata = null;
  try { metadata = await readStoredMetadata(root); } catch (error) { if (!isNotFoundError(error)) throw error; }
  let removed = false;
  if (metadata?.fileName && safeFileName(metadata.fileName)) {
    try { await root.removeEntry(metadata.fileName); removed = true; } catch (error) { if (!isNotFoundError(error)) throw error; }
  }
  try { await root.removeEntry(MODEL_METADATA_FILE); removed = true; } catch (error) { if (!isNotFoundError(error)) throw error; }
  return { removed, supported: true };
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
  // Wllama's compatibility worker can default to a CDN; this app keeps the runtime assets local.
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

export async function streamOfflineModel({
  messages,
  tools = [],
  signal,
  temperature = 0.7,
  maxTokens = OFFLINE_MODEL_MAX_OUTPUT_TOKENS,
  onChunk = () => {},
} = {}, { engineProvider = getOfflineModelEngine, modelFileProvider = getOfflineModelFile } = {}) {
  activeOfflineRuns++;
  try {
    throwIfAborted(signal);
    const localModel = await modelFileProvider();
    if (!localModel?.file || typeof localModel.file.slice !== 'function') {
      throw new Error('尚未选择本地 GGUF。请前往“设置 → 离线本地模型”选择文件；本次推理没有尝试联网。');
    }
    throwIfAborted(signal);
    const engine = await engineProvider();
    const modelKey = String(localModel.metadata?.fileName || localModel.file.name || `${localModel.file.size}:${localModel.metadata?.importedAt || ''}`);
    const isLoaded = typeof engine.isModelLoaded === 'function' && engine.isModelLoaded();
    if (!isLoaded || loadedModelKey !== modelKey) {
      if (isLoaded) await engine.exit?.();
      // Wllama 3.8.1 accepts Blob[] directly; the OPFS File is passed locally, never as a URL.
      await engine.loadModel([localModel.file], {
        n_ctx: OFFLINE_MODEL_CONTEXT_SIZE,
        n_batch: 512,
        n_threads: Math.max(1, Math.min(4, Math.floor(Number(globalThis.navigator?.hardwareConcurrency) / 2) || 2)),
        warmup: false,
      });
      loadedModelKey = modelKey;
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
