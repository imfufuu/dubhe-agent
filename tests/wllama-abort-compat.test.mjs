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
