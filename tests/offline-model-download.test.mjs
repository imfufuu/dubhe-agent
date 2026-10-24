import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadOpfsFile } from '../js/offline-model-download-core.js';

function memoryOpfs(initial = {}) {
  const files = new Map(Object.entries(initial).map(([name, value]) => [name, new Uint8Array(value)]));
  const dataFor = (name) => files.get(name) || new Uint8Array();
  const handleFor = (name) => ({
    async createSyncAccessHandle() {
      return {
        getSize: () => dataFor(name).byteLength,
        truncate(size) {
          const current = dataFor(name);
          const next = new Uint8Array(Math.max(0, Number(size) || 0));
          next.set(current.subarray(0, next.length)); files.set(name, next);
        },
        write(bytes, { at = 0 } = {}) {
          const current = dataFor(name);
          const end = Number(at) + bytes.byteLength;
          const next = new Uint8Array(Math.max(current.byteLength, end));
          next.set(current); next.set(bytes, Number(at)); files.set(name, next);
          return bytes.byteLength;
        },
        flush() {}, close() {},
      };
    },
    async createWritable() {
      let staged = new Uint8Array();
      return {
        async write(value) { staged = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value); },
        async close() { files.set(name, staged); },
      };
    },
    async getFile() { return new Blob([dataFor(name)]); },
  });
  const cacheDir = { async getFileHandle(name) { return handleFor(name); } };
  const storage = { async getDirectory() { return { async getDirectoryHandle() { return cacheDir; } }; } };
  return { files, storage };
}
const bytes = (data) => Array.from(data);
const head = (total, etag = '"model-v1"') => new Response(null, {
  status: 200, headers: { 'content-length': String(total), etag },
});
const rangeResponse = (full, start, etag = '"model-v1"') => new Response(full.slice(start), {
  status: 206,
  headers: { 'content-range': `bytes ${start}-${full.length - 1}/${full.length}`, 'content-length': String(full.length - start), etag },
});

test('an interrupted OPFS write preserves bytes and the next request resumes with HTTP Range', async () => {
  const full = new Uint8Array([11, 22, 33, 44, 55, 66]);
  const partial = new Uint8Array([11, 22]);
  const { files, storage } = memoryOpfs({ 'model.gguf': partial });
  const calls = [];
  let sentChunk = false;
  const interrupted = new ReadableStream({
    pull(controller) {
      if (!sentChunk) { sentChunk = true; controller.enqueue(full.slice(2, 4)); }
      else controller.error(new TypeError('socket reset'));
    },
  });
  await assert.rejects(downloadOpfsFile({
    url: 'https://example.test/model.gguf', fileName: 'model.gguf', totalBytes: full.length,
    storage,
    fetchImpl: async (_url, options = {}) => {
      calls.push({ method: options.method || 'GET', range: options.headers?.Range || '', cache: options.cache });
      if (options.method === 'HEAD') return head(full.length);
      assert.equal(options.headers?.Range, 'bytes=2-');
      return new Response(interrupted, { status: 206, headers: { 'content-range': `bytes 2-5/${full.length}`, 'content-length': '4', etag: '"model-v1"' } });
    },
  }), /socket reset/);
  assert.deepEqual(bytes(files.get('model.gguf')), [11, 22, 33, 44]);
  assert.equal(JSON.parse(new TextDecoder().decode(files.get('__metadata__model.gguf'))).downloadState, 'partial');

  const resumed = await downloadOpfsFile({
    url: 'https://example.test/model.gguf', fileName: 'model.gguf', totalBytes: full.length,
    etag: '"model-v1"', storage,
    fetchImpl: async (_url, options = {}) => {
      calls.push({ method: options.method || 'GET', range: options.headers?.Range || '', cache: options.cache });
      if (options.method === 'HEAD') return head(full.length);
      assert.equal(options.headers?.Range, 'bytes=4-');
      return rangeResponse(full, 4);
    },
  });
  assert.deepEqual(bytes(files.get('model.gguf')), bytes(full));
  assert.equal(resumed.loaded, full.length);
  assert.deepEqual(calls.map((call) => call.method), ['HEAD', 'GET', 'HEAD', 'GET']);
  assert.ok(calls.every((call) => call.cache === 'no-store'), 'resume probes and byte-range requests bypass any cached full response');
});

test('a legacy Wllama-normalized ETag resumes the existing OPFS offset instead of restarting', async () => {
  const full = new Uint8Array([3, 5, 8, 13, 21, 34, 55]);
  const { files, storage } = memoryOpfs({ 'model.gguf': full.slice(0, 4) });
  const ranges = [];
  const progress = [];
  const result = await downloadOpfsFile({
    url: 'https://example.test/model.gguf', fileName: 'model.gguf', totalBytes: full.length,
    // Wllama stored the same ETag as modelv1 after removing quotes and punctuation.
    etag: 'modelv1', storage, onProgress: (event) => progress.push(event.loaded),
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'HEAD') return head(full.length, '"model-v1"');
      ranges.push(options.headers?.Range || '');
      return rangeResponse(full, 4, '"model-v1"');
    },
  });
  assert.deepEqual(ranges, ['bytes=4-'], 'legacy ETag normalization must not turn a valid resume into a full GET');
  assert.deepEqual(bytes(files.get('model.gguf')), bytes(full));
  assert.equal(result.loaded, full.length);
  assert.ok(progress.includes(4), 'the existing byte offset remains visible while resuming');
});

test('a server that ignores Range triggers a safe truncate-and-restart instead of corrupt append', async () => {
  const full = new Uint8Array([1, 2, 3, 4, 5]);
  const { files, storage } = memoryOpfs({ 'model.gguf': new Uint8Array([1, 2, 99]) });
  const calls = [];
  await downloadOpfsFile({
    url: 'https://example.test/model.gguf', fileName: 'model.gguf', totalBytes: full.length,
    etag: '"model-v1"', storage,
    fetchImpl: async (_url, options = {}) => {
      calls.push({ method: options.method || 'GET', range: options.headers?.Range || '', cache: options.cache });
      if (options.method === 'HEAD') return head(full.length);
      return new Response(full, { status: 200, headers: { 'content-length': String(full.length), etag: '"model-v1"' } });
    },
  });
  assert.equal(calls.at(-1).range, 'bytes=3-');
  assert.deepEqual(bytes(files.get('model.gguf')), bytes(full));
});

test('a changed ETag discards incompatible partial bytes and starts from byte zero', async () => {
  const full = new Uint8Array([7, 8, 9, 10]);
  const { files, storage } = memoryOpfs({ 'model.gguf': new Uint8Array([99, 99]) });
  const ranges = [];
  await downloadOpfsFile({
    url: 'https://example.test/model.gguf', fileName: 'model.gguf', totalBytes: full.length,
    etag: '"old-version"', storage,
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'HEAD') return head(full.length, '"new-version"');
      ranges.push(options.headers?.Range || '');
      return new Response(full, { status: 200, headers: { 'content-length': String(full.length), etag: '"new-version"' } });
    },
  });
  assert.deepEqual(ranges, ['']);
  assert.deepEqual(bytes(files.get('model.gguf')), bytes(full));
});
