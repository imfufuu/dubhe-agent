import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OFFLINE_MODEL_CONTEXT_BUDGET, OFFLINE_MODEL_CONTEXT_SIZE, OFFLINE_MODEL_ID, LEGACY_OFFLINE_MODEL_IDS, MAX_SINGLE_GGUF_BYTES, isOfflineModelId } from '../js/offline-model-config.js';
import { getOfflineModelFile, getOfflineModelStatus, importOfflineModel, removeOfflineModel, streamOfflineModel, supportsOfflineModelStorage, syncOfflineModelAvailability } from '../js/offline-model.js';
import { OFFLINE_ALLOWED_TOOL_NAMES, isOfflineToolAllowed } from '../js/offline-policy.js';
import { TOOL_DEFS, executeTool } from '../js/tools.js';
import { createAgent } from '../js/agent.js';
import { createStore } from '../js/state.js';
import { streamChat, fetchModels } from '../js/api.js';
import { updateScriptCache } from '../js/cache-update.js';
import { makeGGUF } from './helpers/gguf-fixture.mjs';

const setGlobal = (name, value) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => { if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name]; };
};
function offlineGate(value = true) {
  return setGlobal('__dubheOfflineNetworkGate', { offline: value, blockedRequests: [], record(input, kind) { this.blockedRequests.push({ input, kind }); } });
}
function notFound(name) {
  const error = new Error(`${name} not found`);
  error.name = 'NotFoundError';
  return error;
}
function fakeOPFS({ quotaBytes = 20 * 1024 ** 3 } = {}) {
  const files = new Map();
  const root = {
    async getFileHandle(name, { create = false } = {}) {
      if (!files.has(name)) {
        if (!create) throw notFound(name);
        files.set(name, new Blob([]));
      }
      return {
        async getFile() { return files.get(name); },
        async createWritable() {
          const chunks = [];
          return new WritableStream({
            write(chunk) { chunks.push(chunk); },
            close() { files.set(name, new Blob(chunks)); },
            abort() { chunks.length = 0; },
          });
        },
      };
    },
    async removeEntry(name) {
      if (!files.has(name)) throw notFound(name);
      files.delete(name);
    },
  };
  return {
    files,
    root,
    storage: {
      async getDirectory() { return root; },
      async persist() { return true; },
      async estimate() { return { quota: quotaBytes, usage: [...files.values()].reduce((sum, file) => sum + file.size, 0) }; },
    },
  };
}

function namedGGUF(fileName = 'sample-1B-Q4_K_M.gguf', overrides = {}) {
  return makeGGUF({ fileName, ...overrides });
}

test('offline model identity is a generic GGUF slot and recognizes the former local ID only for migration', () => {
  assert.equal(OFFLINE_MODEL_ID, 'local/gguf');
  assert.equal(isOfflineModelId(OFFLINE_MODEL_ID), true);
  assert.ok(LEGACY_OFFLINE_MODEL_IDS.includes('local/qwen2.5-1.5b-instruct-heretic-q4_k_m'));
  assert.equal(isOfflineModelId(LEGACY_OFFLINE_MODEL_IDS[0]), true);
  assert.equal(isOfflineModelId('gpt-5.6-sol'), false);
  assert.equal(OFFLINE_MODEL_CONTEXT_SIZE, 4096);
  assert.equal(OFFLINE_MODEL_CONTEXT_BUDGET, 3072);
  assert.equal(MAX_SINGLE_GGUF_BYTES, (2 * 1024 ** 3) - 1);
});

test('OPFS support requires a secure context and the browser storage API', () => {
  assert.equal(supportsOfflineModelStorage({ navigatorImpl: { storage: { getDirectory() {} } }, secureContext: true }), true);
  assert.equal(supportsOfflineModelStorage({ navigatorImpl: { storage: {} }, secureContext: true }), false);
  assert.equal(supportsOfflineModelStorage({ navigatorImpl: { storage: { getDirectory() {} } }, secureContext: false }), false);
});

test('status check is local-only and reports an empty OPFS as no selected model', async () => {
  const opfs = fakeOPFS();
  const status = await getOfflineModelStatus({ storage: opfs.storage, secureContext: true });
  assert.deepEqual(status, { supported: true, available: false, size: 0, metadata: null });
  const store = createStore();
  const synced = await syncOfflineModelAvailability(store, { storage: opfs.storage, notify: false });
  assert.equal(synced.available, false);
  assert.equal(store.state.offlineModelMetadata, null);
  assert.equal(store.state.offlineModelChecked, true);
});

test('local GGUF import parses metadata, copies it into OPFS and reports progress without network access', async () => {
  const opfs = fakeOPFS();
  const file = namedGGUF('sample-1.5B-Q4_K_M.gguf', { modelName: 'Sample GGUF 1.5B', parameterCount: 1_500_000_000n });
  const progress = [];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('model import must not use fetch'); };
  try {
    const result = await importOfflineModel(file, {
      storage: opfs.storage,
      fileNameFactory: () => 'dubhe-local-model-test-1.gguf',
      onProgress: (event) => progress.push(event),
    });
    assert.equal(result.available, true);
    assert.equal(result.metadata.displayName, 'Sample GGUF 1.5B');
    assert.equal(result.metadata.parameterCount, 1_500_000_000);
    assert.equal(result.metadata.parameterCountSource, 'gguf-metadata');
    assert.equal(result.metadata.quantization, 'Q4_K_M');
    assert.equal(result.size, file.size);
    assert.ok(opfs.files.has(result.metadata.fileName));
    assert.equal((await opfs.files.get(result.metadata.fileName).arrayBuffer()).byteLength, file.size);
    assert.equal(progress[0].percent, 0);
    assert.equal(progress.at(-1).percent, 100);
    assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('replacing a GGUF is commit-safe and deletes the old file only after the new file is indexed', async () => {
  const opfs = fakeOPFS();
  const first = namedGGUF('first-1B-Q4_K_M.gguf', { modelName: 'First' });
  const second = namedGGUF('second-3B-Q5_K_M.gguf', { modelName: 'Second', parameterCount: 3_000_000_000n });
  await importOfflineModel(first, { storage: opfs.storage, fileNameFactory: () => 'dubhe-local-model-first.gguf' });
  const replacement = await importOfflineModel(second, { storage: opfs.storage, fileNameFactory: () => 'dubhe-local-model-second.gguf' });
  assert.equal(replacement.available, true);
  assert.equal(replacement.metadata.displayName, 'Second');
  assert.equal(opfs.files.has('dubhe-local-model-first.gguf'), false);
  assert.equal(opfs.files.has('dubhe-local-model-second.gguf'), true);
  assert.equal(JSON.parse(await opfs.files.get('dubhe-local-model.json').text()).fileName, 'dubhe-local-model-second.gguf');
});

test('aborting an OPFS copy removes the incomplete new file and leaves the previous model available', async () => {
  const opfs = fakeOPFS();
  await importOfflineModel(namedGGUF('original-1B.gguf', { modelName: 'Original' }), {
    storage: opfs.storage,
    fileNameFactory: () => 'dubhe-local-model-original.gguf',
  });
  const controller = new AbortController();
  await assert.rejects(importOfflineModel(namedGGUF('replacement-2B.gguf', { modelName: 'Replacement' }), {
    storage: opfs.storage,
    signal: controller.signal,
    fileNameFactory: () => 'dubhe-local-model-partial.gguf',
    onProgress: (progress) => { if (progress.loaded > 0) controller.abort(); },
  }), (error) => error.name === 'AbortError');
  const status = await getOfflineModelStatus({ storage: opfs.storage, secureContext: true });
  assert.equal(status.available, true);
  assert.equal(status.metadata.displayName, 'Original');
  assert.equal(opfs.files.has('dubhe-local-model-original.gguf'), true);
  assert.equal(opfs.files.has('dubhe-local-model-partial.gguf'), false);
});

test('invalid extensions, oversized files and a clearly insufficient OPFS quota are rejected', async () => {
  const opfs = fakeOPFS({ quotaBytes: 100 });
  const wrongExtension = namedGGUF('model.bin');
  await assert.rejects(importOfflineModel(wrongExtension, { storage: opfs.storage }), /只接受单文件 \.gguf/);
  const tooLarge = { name: 'huge.gguf', size: MAX_SINGLE_GGUF_BYTES + 1, stream() { throw new Error('should not read an oversized file'); } };
  await assert.rejects(importOfflineModel(tooLarge, { storage: opfs.storage }), /小于 2 GiB/);
  await assert.rejects(importOfflineModel(namedGGUF(), { storage: opfs.storage }), /本地存储空间可能不足/);
  assert.equal(opfs.files.size, 0);
});

test('a selected file can be re-opened from OPFS and removed without constructing Wllama or accessing a gateway', async () => {
  const opfs = fakeOPFS();
  await importOfflineModel(namedGGUF('local-1B.gguf', { modelName: 'Local' }), {
    storage: opfs.storage,
    fileNameFactory: () => 'dubhe-local-model-local.gguf',
  });
  const local = await getOfflineModelFile({ storage: opfs.storage });
  assert.equal(local.metadata.displayName, 'Local');
  assert.equal(local.file.size, local.metadata.fileSize);
  const removed = await removeOfflineModel({ storage: opfs.storage });
  assert.deepEqual(removed, { removed: true, supported: true });
  assert.equal((await getOfflineModelStatus({ storage: opfs.storage, secureContext: true })).available, false);
});

test('local inference passes the OPFS Blob array to Wllama 3.8.1 and never fetches a model URL', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('local inference must not fetch'); };
  let loaded = [];
  let loadCalls = 0;
  let exits = 0;
  let request = null;
  let isLoaded = false;
  const chunks = [{ choices: [{ delta: { content: 'Local answer.' } }] }];
  const engine = {
    isModelLoaded() { return isLoaded; },
    async loadModel(value, options) { loaded.push({ value, options }); loadCalls++; isLoaded = true; },
    async exit() { exits++; isLoaded = false; },
    async createChatCompletion(options) { request = options; return (async function* () { yield* chunks; })(); },
  };
  const fileA = new Blob(['model-a']);
  const fileB = new Blob(['model-b']);
  const seen = [];
  try {
    await streamOfflineModel({ messages: [{ role: 'user', content: 'hello' }], onChunk: (chunk) => seen.push(chunk) }, {
      engineProvider: async () => engine,
      modelFileProvider: async () => ({ file: fileA, metadata: { fileName: 'model-a.gguf' } }),
    });
    assert.deepEqual(loaded[0].value, [fileA], 'loadModel receives a local Blob array, not a Model URL');
    assert.equal(loaded[0].options.n_ctx, 4096);
    assert.equal(request.model, OFFLINE_MODEL_ID);
    assert.equal(request.stream, true);
    assert.ok(request.max_tokens <= 768);
    assert.deepEqual(seen, chunks);
    await streamOfflineModel({ messages: [] }, {
      engineProvider: async () => engine,
      modelFileProvider: async () => ({ file: fileA, metadata: { fileName: 'model-a.gguf' } }),
    });
    assert.equal(loadCalls, 1, 'the same stored file is loaded only once');
    await streamOfflineModel({ messages: [] }, {
      engineProvider: async () => engine,
      modelFileProvider: async () => ({ file: fileB, metadata: { fileName: 'model-b.gguf' } }),
    });
    assert.equal(exits, 1);
    assert.equal(loadCalls, 2);
    assert.deepEqual(loaded[1].value, [fileB]);
    assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('local inference stop settles a stalled async iterator and tears down its worker as a fallback', async () => {
  const controller = new AbortController();
  let loaded = false, exits = 0;
  const engine = {
    isModelLoaded() { return loaded; },
    async loadModel() { loaded = true; },
    async exit() { exits++; loaded = false; },
    async createChatCompletion() {
      return {
        [Symbol.asyncIterator]() {
          return { next: () => new Promise(() => {}), return: () => new Promise(() => {}) };
        },
      };
    },
  };
  const pending = streamOfflineModel({ signal: controller.signal, messages: [{ role: 'user', content: 'stop test' }] }, {
    engineProvider: async () => engine,
    modelFileProvider: async () => ({ file: new Blob(['local-model']), metadata: { fileName: 'abort-hanging-stream.gguf' } }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const stoppedAt = Date.now();
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.ok(Date.now() - stoppedAt < 250, 'the caller should settle promptly rather than waiting for another model token');
  await new Promise((resolve) => setTimeout(resolve, 720));
  assert.equal(exits, 1, 'a non-cooperative worker is terminated after the abort grace period');
});

test('aborting model loading immediately retires the Wllama worker instead of waiting for loadModel', async () => {
  const controller = new AbortController();
  let loadStarted;
  const started = new Promise((resolve) => { loadStarted = resolve; });
  let exits = 0;
  const engine = {
    isModelLoaded() { return false; },
    loadModel() { loadStarted(); return new Promise(() => {}); },
    exit() { exits++; },
  };
  const pending = streamOfflineModel({ signal: controller.signal }, {
    engineProvider: async () => engine,
    modelFileProvider: async () => ({ file: new Blob(['local-model']), metadata: { fileName: 'abort-loading.gguf' } }),
  });
  await started;
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(exits, 1, 'load cancellation explicitly tears down the in-flight worker');
});

test('missing local GGUF fails before Wllama engine initialization and states that no network was attempted', async () => {
  let engineCalls = 0;
  await assert.rejects(streamOfflineModel({}, {
    engineProvider: async () => { engineCalls++; return {}; },
    modelFileProvider: async () => { throw new Error('尚未选择本地 GGUF。'); },
  }), /尚未选择本地 GGUF/);
  assert.equal(engineCalls, 0);
});

test('offline state rejects remote chat and model-catalog requests before fetch', async () => {
  const restoreGate = offlineGate(true);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network'); };
  try {
    await assert.rejects(streamChat({ model: 'gpt-5.6-sol', apiKey: 'test-key', messages: [] }), /离线模式只允许/);
    await assert.rejects(fetchModels('test-key'), /离线模式/);
    await assert.rejects(streamChat({ model: OFFLINE_MODEL_ID, messages: [{ role: 'user', content: 'hello' }] }), /尚未选择本地 GGUF/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restoreGate(); }
});

test('offline update check stops before build-manifest fetch', async () => {
  const restoreGate = offlineGate(true);
  let calls = 0;
  try {
    await assert.rejects(updateScriptCache({ currentVersion: '2026.10.22.1', fetchImpl: async () => { calls++; return Response.json({}); } }), (error) => error.code === 'offline');
    assert.equal(calls, 0);
  } finally { restoreGate(); }
});

test('offline tool allowlist is immutable, exists in TOOL_DEFS and contains no remote tool', () => {
  const actual = new Set(TOOL_DEFS.map((tool) => tool.name));
  assert.ok(Object.isFrozen(OFFLINE_ALLOWED_TOOL_NAMES));
  assert.deepEqual(OFFLINE_ALLOWED_TOOL_NAMES.filter((name) => !actual.has(name)), []);
  for (const name of ['read_file', 'write_file', 'document_tool', 'xlsx_tool', 'knowledge_search', 'execute_javascript', 'execute_cpp']) assert.equal(isOfflineToolAllowed(name), true);
  for (const name of ['fetch_url', 'search_web', 'crawl_site', 'generate_image', 'analyze_image', 'dispatch_subagent']) assert.equal(isOfflineToolAllowed(name), false);
});

test('preview tool table matches the local-only allowlist for a local GGUF model', () => {
  const store = createStore();
  store.state.model = OFFLINE_MODEL_ID;
  store.state.relayOk = true;
  const agent = createAgent(store, {});
  const preview = agent.previewToolTable({ text: 'create a local file' });
  assert.ok(preview.allowed.length > 0);
  assert.ok(preview.allowed.every(isOfflineToolAllowed));
  assert.ok(preview.allowed.includes('execute_cpp'), 'the local C++ Worker remains available offline');
  assert.ok(!preview.allowed.some((name) => ['fetch_url', 'search_web', 'crawl_site', 'generate_image', 'dispatch_subagent'].includes(name)));
  assert.equal(preview.tier.canDispatch, false);
  assert.ok(preview.dropped.some((entry) => entry.reason === 'offline-local-only'));
});

test('tool execution provides a final fail-closed guard before a remote tool can run', async () => {
  const restoreGate = offlineGate(true);
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected network'); };
  try {
    const result = await executeTool('fetch_url', { url: 'https://example.com' }, { model: 'gpt-5.6-sol', fs: {}, onUi() {} });
    assert.match(result, /已阻止 fetch_url/);
    assert.equal(calls, 0);
    const localResult = await executeTool('analyze_image', {}, { model: OFFLINE_MODEL_ID, fs: {}, onUi() {} });
    assert.match(localResult, /仅允许本地工具/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restoreGate(); }
});

test('local-only sends skip remote API Key prompts without relaxing the gateway-key requirement for remote models', () => {
  const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /if \(!store\.state\.apiKey && !isOfflineModelId\(store\.state\.model\)\) \{ composerDraftAwaitingKey = text; openKeyModal\(\); toast\('请先配置 TeamoRouter API Key（输入内容已保留，保存后自动放回）', 'warn'\); return; \}/);
  assert.match(ui, /if \(!store\.state\.apiKey && !isOfflineModelId\(store\.state\.model\)\) setTimeout\(openKeyModal, 600\);/);
  const choices = fs.readFileSync(new URL('../js/ui-choices.js', import.meta.url), 'utf8');
  assert.match(choices, /if \(!store\.state\.apiKey && !isOfflineModelId\(store\.state\.model\)\) \{ openKeyModal\(\); toast\('请先配置 TeamoRouter API Key', 'warn'\); setChoiceStep\(box, idx\); return true; \}/);
});

test('settings expose a local GGUF chooser and no fixed remote model downloader', () => {
  const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const model = fs.readFileSync(new URL('../js/offline-model.js', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../js/offline-model-config.js', import.meta.url), 'utf8');
  assert.match(app, /id="set-offline-model-file-input" type="file" accept="\.gguf/);
  assert.match(app, /id="set-offline-model-choose"/);
  assert.doesNotMatch(app, /set-offline-model-download|huggingface\.co\/saidutta69/);
  assert.doesNotMatch(model, /downloadOfflineModel|loadModelFromUrl|fetch\(/);
  assert.doesNotMatch(config, /https:\/\/huggingface\.co|OFFLINE_MODEL_URL|OFFLINE_MODEL_SHA256/);
  assert.ok(!fs.existsSync(new URL('../js/offline-model-download-worker.js', import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../js/offline-model-download-core.js', import.meta.url)));
});

test('offline bootstrap is installed on all cached entry pages and blocks offsite navigation/resources', () => {
  for (const file of ['index.html', 'docs.html', 'app.html']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const version = source.match(/<meta name="app-version" content="([^"]+)"\s*\/>/)?.[1];
    assert.ok(version, `${file} declares its active app version`);
    assert.ok(source.includes(`<script src="js/offline-bootstrap.js?v=${version}"></script>`), `${file} loads the synchronous network fence at the active version`);
    assert.ok(source.indexOf('offline-bootstrap.js') < source.indexOf('theme-boot.js'), `${file} installs the fence before other entry scripts`);
  }
  const bootstrap = fs.readFileSync(new URL('../js/offline-bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /connect-src 'self' blob:/);
  assert.match(bootstrap, /offlineGuardedFetch/);
  assert.match(bootstrap, /offlineGuardedXhrOpen/);
  assert.match(bootstrap, /offlineGuardedOpen/);
  assert.match(bootstrap, /gate\.record\(anchor\.href, 'navigation'\)/);
  assert.match(bootstrap, /abort\(\)/);
});
