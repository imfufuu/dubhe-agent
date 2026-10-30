import test from 'node:test';
import assert from 'node:assert/strict';
import { patchWllamaAbortMessageHandling } from '../js/wllama-abort-compat.js';

test('Wllama abort payload is normalized and forwarded to abort() synchronously', () => {
  class FakeWllama {
    constructor() { this.aborts = []; this.logger = { error() {} }; }
    onRecvMsg() { throw new Error('original handler must not run for signal.abort'); }
    abort(message, stack) { this.aborts.push([message, stack]); }
  }
  assert.equal(patchWllamaAbortMessageHandling(FakeWllama), true);
  const runtime = new FakeWllama();
  const result = runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', undefined, undefined, null] } });
  assert.equal(result, undefined, 'must not return a detached promise (that caused window.rejection)');
  assert.deepEqual(runtime.aborts, [['(ABORT) Local model aborted.', '']]);
});

test('missing or non-string abort fields never throw and still reject pending tasks through abort()', () => {
  class FakeWllama {
    constructor() { this.aborts = []; this.logger = { error() {} }; }
    onRecvMsg() {}
    abort(message, stack) { this.aborts.push([message, stack]); }
  }
  assert.equal(patchWllamaAbortMessageHandling(FakeWllama), true);
  const runtime = new FakeWllama();
  runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', { code: 1 }, null, 'original'] } });
  assert.equal(runtime.aborts[0][0], '(ABORT) [object Object]');
  assert.equal(runtime.aborts[0][1], '');
});

test('the assertion hint is stripped and abort stacks use newline separators', () => {
  class FakeWllama {
    constructor() { this.aborts = []; this.logger = { error() {} }; }
    onRecvMsg() {}
    abort(message, stack) { this.aborts.push([message, stack]); }
  }
  patchWllamaAbortMessageHandling(FakeWllama);
  const runtime = new FakeWllama();
  runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', 'OOM Build with -sASSERTIONS for more info.', 'a|b|c', null] } });
  assert.deepEqual(runtime.aborts[0], ['(ABORT) OOM', 'a\nb\nc']);
});

test('exception payloads are surfaced with the original message and stack', () => {
  class FakeWllama {
    constructor() { this.aborts = []; this.logger = { error() {} }; }
    onRecvMsg() {}
    abort(message, stack) { this.aborts.push([message, stack]); }
  }
  patchWllamaAbortMessageHandling(FakeWllama);
  const runtime = new FakeWllama();
  runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['exception', 'decode', 'stack', null] } });
  assert.deepEqual(runtime.aborts[0], ['decode', 'stack']);
});

test('if abort() itself throws, the original reason is forwarded with a fallback stack', () => {
  class BrokenWllama {
    constructor() { this.aborts = []; this.logger = { error() {} }; this.calls = 0; }
    onRecvMsg() {}
    abort(message, stack) {
      this.calls += 1;
      if (this.calls === 1) throw new TypeError('replace is not a function');
      this.aborts.push([message, stack]);
    }
  }
  assert.equal(patchWllamaAbortMessageHandling(BrokenWllama), true);
  const runtime = new BrokenWllama();
  runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', 'boom', 'x', null] } });
  assert.equal(runtime.aborts.length, 1);
  assert.equal(runtime.aborts[0][0], '(ABORT) boom');
});

test('non-abort Wllama events pass through unchanged and patching is idempotent', () => {
  class FakeWllama {
    onRecvMsg(event) { this.lastEvent = event; }
  }
  assert.equal(patchWllamaAbortMessageHandling(FakeWllama), true);
  assert.equal(patchWllamaAbortMessageHandling(FakeWllama), true);
  const runtime = new FakeWllama();
  const event = { data: { verb: 'console.log', args: ['ok'] } };
  runtime.onRecvMsg(event);
  assert.equal(runtime.lastEvent, event);
});

// ── 以下用真实 vendor 代码验证（上面的 FakeWllama 结构与真实运行时不一致，曾掩盖了补丁从未生效的问题）──
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { guardWllamaProxy } from '../js/wllama-abort-compat.js';

async function loadRealProxyClass() {
  const src = fs.readFileSync(new URL('../assets/vendor/wllama/wllama-3.8.1.js', import.meta.url), 'utf8');
  const tmp = path.join(os.tmpdir(), `wllama-real-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(tmp, `${src}\nexport { ProxyToWorker };\n`);
  try { return (await import(tmp)).ProxyToWorker; } finally { fs.rmSync(tmp, { force: true }); }
}

function realProxy(ProxyToWorker) {
  const p = Object.create(ProxyToWorker.prototype);
  p.resources = { compat: null };
  p.logger = { error() {}, warn() {}, log() {}, debug() {} };
  p.resultQueue = []; p.taskQueue = [];
  return p;
}

const numericAbort = { data: { verb: 'signal.abort', args: ['abort', 12345, '', undefined] } };

test('real vendor: guardWllamaProxy patches the proxy prototype before the worker handler is bound', async () => {
  const ProxyToWorker = await loadRealProxyClass();
  const runtime = guardWllamaProxy({});
  const proxy = realProxy(ProxyToWorker);
  let rejected = null;
  proxy.resultQueue.push({ resolve() {}, reject: (e) => { rejected = e; } });
  const seen = [];
  const onUnhandled = (e) => seen.push(String(e && e.message));
  process.on('unhandledRejection', onUnhandled);
  try {
    runtime.proxy = proxy;
    runtime.proxy.onRecvMsg(numericAbort);
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(seen, [], 'no window.rejection after the guard');
    assert.match(String(rejected && rejected.message), /\(ABORT\) 12345/, 'pending inference must be rejected, not left spinning');
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('real vendor: an incompatible proxy is refused loudly instead of silently running the broken handler', () => {
  const runtime = guardWllamaProxy({});
  assert.throws(() => { runtime.proxy = {}; }, /不兼容（缺少 onRecvMsg）/);
});

test('wiring: offline-model guards the runtime proxy instead of patching the exported class', () => {
  const src = fs.readFileSync(new URL('../js/offline-model.js', import.meta.url), 'utf8');
  assert.match(src, /guardWllamaProxy\(runtime\);/);
  assert.doesNotMatch(src, /patchWllamaAbortMessageHandling\(wllamaModule\.Wllama\)/);
});

test('wiring: vendored Wllama still binds the worker handler after creating the proxy (guard assumptions)', () => {
  const vendor = fs.readFileSync(new URL('../assets/vendor/wllama/wllama-3.8.1.js', import.meta.url), 'utf8');
  assert.match(vendor, /this\.proxy = new ProxyToWorker\(/);
  assert.match(vendor, /this\.worker\.onmessage = this\.onRecvMsg\.bind\(this\);/);
});
