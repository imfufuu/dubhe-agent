import test from 'node:test';
import assert from 'node:assert/strict';
import { patchWllamaAbortMessageHandling } from '../js/wllama-abort-compat.js';

test('Wllama abort payload formatting receives safe strings for message and stack', () => {
  class FakeWllama {
    onRecvMsg(event) { this.lastMessage = event.data; return 'handled'; }
  }
  assert.equal(patchWllamaAbortMessageHandling(FakeWllama), true);
  const runtime = new FakeWllama();
  const result = runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', { code: 1 }, null, 'original'] } });
  assert.equal(result, 'handled');
  assert.deepEqual(runtime.lastMessage.args, ['abort', '[object Object]', '', 'original']);
});

test('a synchronous abort-handler error falls back to the original abort instead of masking it', () => {
  class BrokenWllama {
    onRecvMsg() { throw new TypeError('replace is not a function'); }
    abort(message, stack) { this.abortArgs = [message, stack]; }
    logger = { error() {} };
  }
  assert.equal(patchWllamaAbortMessageHandling(BrokenWllama), true);
  const runtime = new BrokenWllama();
  runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['abort', undefined, undefined] } });
  assert.match(runtime.abortArgs[0], /^\(ABORT\) replace is not a function/u);
  assert.match(runtime.abortArgs[1], /TypeError/u);
});

test('promise rejections from a returned abort handler are caught and surfaced', async () => {
  class AsyncBrokenWllama {
    onRecvMsg() { return Promise.reject(new Error('decode failed')); }
    abort(message, stack) { this.abortArgs = [message, stack]; }
    logger = { error() {} };
  }
  assert.equal(patchWllamaAbortMessageHandling(AsyncBrokenWllama), true);
  const runtime = new AsyncBrokenWllama();
  await runtime.onRecvMsg({ data: { verb: 'signal.abort', args: ['exception', 'decode', 'stack'] } });
  assert.equal(runtime.abortArgs[0], 'decode');
  assert.equal(runtime.abortArgs[1], 'stack');
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
