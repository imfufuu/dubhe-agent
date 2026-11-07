import { test } from 'node:test';
import assert from 'node:assert/strict';

test('FFmpeg fatal failure settles queued jobs and permits a later explicit retry', async () => {
  const original = globalThis.Worker;
  const workers = [];
  class FakeWorker {
    constructor() { workers.push(this); this.jobs = []; }
    postMessage(job) { this.jobs.push(job); }
    terminate() { this.terminated = true; }
    send(msg) { this.onmessage({ data: msg }); }
  }
  globalThis.Worker = FakeWorker;
  try {
    const { convertWithFfmpeg } = await import('../js/convert.js?retry-test');
    const first = convertWithFfmpeg(new Uint8Array([1]), ['out.mp3']);
    const queued = convertWithFfmpeg(new Uint8Array([2]), ['out.mp3']);
    workers[0].send({ id: workers[0].jobs[0].id, fatal: true, ok: false, error: 'temporary download error' });
    await Promise.all([assert.rejects(first, /temporary download/), assert.rejects(queued, /temporary download/)]);
    assert.equal(workers[0].terminated, true);
    const retry = convertWithFfmpeg(new Uint8Array([3]), ['out.mp3']);
    assert.equal(workers.length, 2);
    workers[0].onerror(); // an old worker cannot kill the replacement
    workers[1].send({ id: workers[1].jobs[0].id, ok: true, bytes: new Uint8Array([42]).buffer });
    assert.deepEqual([...await retry], [42]);
  } finally { globalThis.Worker = original; }
});
