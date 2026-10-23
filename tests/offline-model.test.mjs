import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { OFFLINE_MODEL_ID, OFFLINE_MODEL_REPO, OFFLINE_MODEL_REVISION, OFFLINE_MODEL_FILE, OFFLINE_MODEL_URL, OFFLINE_MODEL_SIZE_BYTES, OFFLINE_MODEL_SHA256 } from '../js/offline-model-config.js';
import { downloadOfflineModel, formatOfflineDownloadProgress, sha256Blob, streamOfflineModel, supportsOfflineModelStorage, verifyOfflineModelIntegrity } from '../js/offline-model.js';
import { OFFLINE_ALLOWED_TOOL_NAMES, isOfflineToolAllowed } from '../js/offline-policy.js';
import { TOOL_DEFS, executeTool } from '../js/tools.js';
import { createAgent } from '../js/agent.js';
import { createStore } from '../js/state.js';
import { streamChat, fetchModels } from '../js/api.js';
import { updateScriptCache } from '../js/cache-update.js';

const setGlobal = (name, value) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => { if (prior) Object.defineProperty(globalThis, name, prior); else delete globalThis[name]; };
};
function offlineGate(value = true) {
  return setGlobal('__dubheOfflineNetworkGate', { offline: value, blockedRequests: [], record(input, kind) { this.blockedRequests.push({ input, kind }); } });
}
function fakeModel({ size = OFFLINE_MODEL_SIZE_BYTES, validate = 'valid' } = {}) {
  return {
    url: OFFLINE_MODEL_URL,
    size,
    removed: 0,
    validate() { return validate; },
    async remove() { this.removed++; },
    async open() { return [new Blob(['short fake blob'])]; },
  };
}
function fakeNavigator() {
  return {
    hardwareConcurrency: 4,
    storage: {
      async getDirectory() { return {}; },
      async persist() { return true; },
      async estimate() { return { quota: 2_000_000_000, usage: 0 }; },
    },
  };
}

test('offline model identity is pinned to the expected repository, revision, size and content hash', () => {
  assert.equal(OFFLINE_MODEL_REPO, 'saidutta69/Qwen2.5-1.5B-Instruct-heretic');
  assert.equal(OFFLINE_MODEL_REVISION, 'aef80af71c5b26237c31454f1f570e30eb05f9eb');
  assert.equal(OFFLINE_MODEL_FILE, 'Qwen2.5-1.5B-Instruct-heretic-Q4_K_M.gguf');
  assert.equal(OFFLINE_MODEL_URL, `https://huggingface.co/${OFFLINE_MODEL_REPO}/resolve/${OFFLINE_MODEL_REVISION}/${OFFLINE_MODEL_FILE}`);
  assert.equal(OFFLINE_MODEL_SIZE_BYTES, 986_048_736);
  assert.equal(OFFLINE_MODEL_SHA256, '76d6e62551937fcd4cbcdf9664459cc7c87d08b3570150c6d03161a0233bb0c3');
  assert.equal(OFFLINE_MODEL_ID, 'local/qwen2.5-1.5b-instruct-heretic-q4_k_m');
});

test('streaming SHA-256 matches known and Node crypto digests and reports progress', async () => {
  const small = new Blob(['abc']);
  const smallProgress = [];
  assert.equal(await sha256Blob(small, { onProgress: (p) => smallProgress.push(p) }), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(smallProgress.length > 0);
  assert.equal(smallProgress.at(-1).phase, 'verify');
  const bytes = new Uint8Array(257 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255;
  const expected = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await sha256Blob(new Blob([bytes])), expected);
});

test('streaming SHA-256 honours an already-aborted signal', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sha256Blob(new Blob(['abc']), { signal: controller.signal }), (error) => error.name === 'AbortError');
});

test('storage support is gated on OPFS availability and secure-context status', () => {
  assert.equal(supportsOfflineModelStorage({ navigatorImpl: { storage: { getDirectory() {} } }, secureContext: true }), true);
  assert.equal(supportsOfflineModelStorage({ navigatorImpl: { storage: {} }, secureContext: true }), false);
  assert.equal(supportsOfflineModelStorage({ navigatorImpl: { storage: { getDirectory() {} } }, secureContext: false }), false);
});

test('integrity verifier rejects an unexpected cached blob byte length', async () => {
  const model = fakeModel({ size: OFFLINE_MODEL_SIZE_BYTES - 1 });
  const result = await verifyOfflineModelIntegrity(model);
  assert.deepEqual({ ok: result.ok, reason: result.reason, size: result.size }, { ok: false, reason: 'size-mismatch', size: 15 });
});

test('manual model download calls only the pinned URL and reports download, verification and ready phases', async () => {
  const restoreNavigator = setGlobal('navigator', fakeNavigator());
  const restoreGate = offlineGate(false);
  let downloadedUrl = '', downloadOptions = null, available = false, removedStale = 0;
  const model = fakeModel();
  const engine = { modelManager: {
    cacheManager: { async delete(url) { assert.equal(url, OFFLINE_MODEL_URL); removedStale++; } },
    async getModels() { return available ? [model] : []; },
    async downloadModel(url, options) { downloadedUrl = url; downloadOptions = options; available = true; options.progressCallback({ loaded: 1234, total: OFFLINE_MODEL_SIZE_BYTES }); return model; },
  } };
  const progress = [];
  try {
    const result = await downloadOfflineModel({
      engineProvider: async () => engine,
      onProgress: (p) => progress.push(p),
      verifyIntegrity: async (_candidate, { onProgress: report }) => {
        report({ loaded: OFFLINE_MODEL_SIZE_BYTES, total: OFFLINE_MODEL_SIZE_BYTES, phase: 'verify' });
        return { ok: true, actual: OFFLINE_MODEL_SHA256 };
      },
    });
    assert.equal(result, model);
    assert.equal(downloadedUrl, OFFLINE_MODEL_URL);
    assert.equal(downloadOptions.metadataAdditional.revision, OFFLINE_MODEL_REVISION);
    assert.equal(downloadOptions.metadataAdditional.sha256, OFFLINE_MODEL_SHA256);
    assert.deepEqual(progress.map((p) => p.phase), ['download', 'download', 'verify', 'ready']);
    assert.ok(removedStale >= 1, 'stale incomplete cache is cleaned before a new fetch');
  } finally { restoreGate(); restoreNavigator(); }
});

test('offline state refuses the explicit downloader before creating an engine or fetching', async () => {
  const restoreGate = offlineGate(true);
  const originalFetch = globalThis.fetch; let calls = 0, engines = 0;
  globalThis.fetch = async () => { calls++; throw Error('unexpected network'); };
  try {
    await assert.rejects(downloadOfflineModel({ engineProvider: async () => { engines++; return {}; } }), /离线状态/);
    assert.equal(engines, 0);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restoreGate(); }
});

test('cancelled download best-effort deletes the unverified partial cache', async () => {
  const restoreNavigator = setGlobal('navigator', fakeNavigator());
  const restoreGate = offlineGate(false);
  let deletes = 0;
  const engine = { modelManager: {
    cacheManager: { async delete(url) { assert.equal(url, OFFLINE_MODEL_URL); deletes++; } },
    async getModels() { return []; },
    async downloadModel() { const error = new Error('aborted'); error.name = 'AbortError'; throw error; },
  } };
  try {
    await assert.rejects(downloadOfflineModel({ engineProvider: async () => engine }), (error) => error.name === 'AbortError');
    assert.equal(deletes, 2, 'stale entry and newly partial entry are both cleaned best-effort');
  } finally { restoreGate(); restoreNavigator(); }
});

test('local inference passes a cached model object to Wllama and never fetches a model URL', async () => {
  const restoreGate = offlineGate(true);
  const originalFetch = globalThis.fetch; let fetchCalls = 0, loaded = null, request = null;
  globalThis.fetch = async () => { fetchCalls++; throw Error('network must stay unused'); };
  const model = fakeModel();
  const chunks = [{ choices: [{ delta: { content: 'Local answer.' } }] }];
  const engine = {
    loaded: false,
    isModelLoaded() { return this.loaded; },
    async loadModel(value, options) { loaded = { value, options }; this.loaded = true; },
    async createChatCompletion(options) { request = options; return (async function* () { yield* chunks; })(); },
  };
  const seen = [];
  try {
    await streamOfflineModel({ messages: [{ role: 'user', content: 'hello' }], signal: new AbortController().signal, onChunk: (chunk) => seen.push(chunk) }, {
      engineProvider: async () => engine,
      cachedModelProvider: async () => model,
    });
    assert.equal(loaded.value, model, 'loadModel receives the validated local cache object, not a remote URL');
    assert.equal(loaded.options.n_ctx, 4096);
    assert.equal(request.model, OFFLINE_MODEL_ID);
    assert.equal(request.stream, true);
    assert.ok(request.max_tokens <= 768);
    assert.equal(request.abortSignal.aborted, false);
    assert.deepEqual(seen, chunks);
    assert.equal(fetchCalls, 0);
  } finally { globalThis.fetch = originalFetch; restoreGate(); }
});

test('model and network offline gates reject remote chat and model-catalog requests before fetch', async () => {
  const restoreGate = offlineGate(true);
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('unexpected network'); };
  try {
    await assert.rejects(streamChat({ model: 'gpt-5.6-sol', apiKey: 'test-key', messages: [] }), /离线模式只允许/);
    await assert.rejects(fetchModels('test-key'), /离线模式/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restoreGate(); }
});

test('offline update check stops before build-manifest fetch', async () => {
  const restoreGate = offlineGate(true); let calls = 0;
  try {
    await assert.rejects(updateScriptCache({ currentVersion: '2026.10.22.1', fetchImpl: async () => { calls++; return Response.json({}); } }), (error) => error.code === 'offline');
    assert.equal(calls, 0);
  } finally { restoreGate(); }
});

test('offline tool allowlist is immutable, exists in TOOL_DEFS and contains no remote tool', () => {
  const actual = new Set(TOOL_DEFS.map((tool) => tool.name));
  assert.ok(Object.isFrozen(OFFLINE_ALLOWED_TOOL_NAMES));
  assert.deepEqual(OFFLINE_ALLOWED_TOOL_NAMES.filter((name) => !actual.has(name)), []);
  for (const name of ['read_file', 'write_file', 'document_tool', 'xlsx_tool', 'knowledge_search', 'execute_javascript']) assert.equal(isOfflineToolAllowed(name), true);
  for (const name of ['fetch_url', 'search_web', 'crawl_site', 'generate_image', 'analyze_image', 'dispatch_subagent', 'execute_cpp']) assert.equal(isOfflineToolAllowed(name), false);
});

test('preview tool table matches the local-only allowlist for an installed local model', () => {
  const store = createStore();
  store.state.model = OFFLINE_MODEL_ID;
  store.state.relayOk = true;
  const agent = createAgent(store, {});
  const preview = agent.previewToolTable({ text: 'create a local file' });
  assert.ok(preview.allowed.length > 0);
  assert.ok(preview.allowed.every(isOfflineToolAllowed));
  assert.ok(!preview.allowed.some((name) => ['fetch_url', 'search_web', 'crawl_site', 'generate_image', 'execute_cpp', 'dispatch_subagent'].includes(name)));
  assert.equal(preview.tier.canDispatch, false);
  assert.ok(preview.dropped.some((entry) => entry.reason === 'offline-local-only'));
});

test('tool execution provides a final fail-closed guard before a remote tool can run', async () => {
  const restoreGate = offlineGate(true); let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; throw Error('unexpected network'); };
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
  assert.match(ui, /if \(!store\.state\.apiKey && !isOfflineModelId\(store\.state\.model\)\) \{ openKeyModal\(\); toast\('请先配置 TeamoRouter API Key', 'warn'\); return; \}/);
  assert.match(ui, /if \(!store\.state\.apiKey && !isOfflineModelId\(store\.state\.model\)\) setTimeout\(openKeyModal, 600\);/);
  const choices = fs.readFileSync(new URL('../js/ui-choices.js', import.meta.url), 'utf8');
  assert.match(choices, /if \(!store\.state\.apiKey && !isOfflineModelId\(store\.state\.model\)\) \{ openKeyModal\(\); toast\('请先配置 TeamoRouter API Key', 'warn'\); setChoiceStep\(box, idx\); return true; \}/);
});

test('offline bootstrap is installed on all cached entry pages and blocks offsite navigation/resources', () => {
  for (const file of ['index.html', 'docs.html', 'app.html']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /<script src="js\/offline-bootstrap\.js\?v=2026\.10\.22\.1"><\/script>/, `${file} must load the synchronous network fence`);
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

test('offline progress formatting clamps invalid and over-complete values', () => {
  assert.deepEqual(formatOfflineDownloadProgress({ loaded: 110, total: 100 }), {
    loaded: 100, total: 100, percent: 100, loadedText: '0 KiB', totalText: '0 KiB',
  });
  assert.equal(formatOfflineDownloadProgress({ loaded: -5, total: 100 }).percent, 0);
});
