import assert from 'node:assert/strict';
import { after, test } from 'node:test';

const globalsToRestore = ['document', 'requestIdleCallback', 'fetch', '__DubheModerationTestHooks', '__dubhePrewarmImageModeration'];
const priorDescriptors = new Map(globalsToRestore.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const prefetchLinks = [];
const idleCallbacks = [];
let fetchCalls = 0;
let nudityLoads = 0;
let imageLoads = 0;

globalThis.document = {
  head: { appendChild: (link) => prefetchLinks.push(link) },
  querySelectorAll: () => [],
  createElement: (tag) => ({ tagName: String(tag).toUpperCase(), rel: '', href: '', as: '' }),
};
globalThis.requestIdleCallback = (callback) => { idleCallbacks.push(callback); return idleCallbacks.length; };
globalThis.fetch = async () => {
  fetchCalls += 1;
  return { arrayBuffer: async () => new ArrayBuffer(8) };
};
globalThis.__DubheModerationTestHooks = {
  get nudityDetector() { nudityLoads += 1; return { session: {} }; },
  get imageModel() { imageLoads += 1; return { classify: async () => [] }; },
};

const moderation = await import(new URL(`../js/moderation.js?prewarm-regression=${Date.now()}`, import.meta.url));
const prewarm = globalThis.__dubhePrewarmImageModeration;
assert.equal(typeof prewarm, 'function');

test('startup prefetches local moderation files without instantiating large models or fetching eagerly', async () => {
  const beforeLinks = prefetchLinks.length;
  const beforeFetch = fetchCalls;
  await prewarm('startup');
  assert.equal(fetchCalls, beforeFetch, 'startup must not allocate large response buffers');
  assert.equal(nudityLoads, 0);
  assert.equal(imageLoads, 0);
  assert.equal(prefetchLinks.length - beforeLinks, 5, 'NudeNet, ONNX Runtime and NSFWJS assets remain cache-prefetched');
  assert.ok(prefetchLinks.slice(beforeLinks).every((link) => link.rel === 'prefetch'));
});

test('image attachment still preloads the full local review models before sending', async () => {
  const beforeFetch = fetchCalls;
  await prewarm('attachment');
  assert.equal(fetchCalls - beforeFetch, 11, 'runtime and model shards are warmed locally');
  assert.ok(nudityLoads > 0, 'NudeNet session should be prepared for image review');
  assert.ok(imageLoads > 0, 'NSFWJS model should be prepared for image review');
});

after(() => {
  for (const key of globalsToRestore) {
    const prior = priorDescriptors.get(key);
    if (prior) Object.defineProperty(globalThis, key, prior);
    else delete globalThis[key];
  }
});
