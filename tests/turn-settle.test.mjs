// 回合结束必须释放工具呈现队列：否则工具芯片的逐个揭示计时器未触发时，
// 后续助手总结会一直被 deferred，最终正文永远画不出来（光标一直闪）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolPresentation } from '../js/toolpresentation.js';

function harness() {
  const timers = [];
  const store = new Map();
  const tp = createToolPresentation({
    readMessage: (id) => store.get(id),
    resultIds: () => new Set(['c1', 'c2']),
    schedule: (fn) => { timers.push(fn); return timers.length; },
    cancel: () => {},
  });
  return { tp, timers, store };
}

const toolMsg = {
  id: 'a1', role: 'assistant', done: true, text: '',
  toolCalls: [{ id: 'c1', name: 'x', status: 'ok' }, { id: 'c2', name: 'y', status: 'ok' }],
};
const summary = { id: 'a2', role: 'assistant', done: false, text: '总结正文', toolCalls: [] };

test('工具芯片未揭示完时，后续总结被延后（复现前提）', () => {
  const { tp, store } = harness();
  store.set('a1', toolMsg);
  tp.watch(toolMsg);
  tp.project(toolMsg); // 第一次绘制：只揭示第 1 个，计时器已排队但未触发
  assert.equal(tp.deferred(summary, [toolMsg, summary]), true);
});

test('release() 后总结不再被延后，且工具芯片全部可见', () => {
  const { tp, timers, store } = harness();
  store.set('a1', toolMsg);
  tp.watch(toolMsg);
  tp.project(toolMsg);
  tp.release();
  assert.equal(tp.deferred(summary, [toolMsg, summary]), false);
  assert.equal(tp.project(toolMsg, { advance: false }).toolCalls.length, 2);
  // 释放后再触发残留计时器不能再推进或重新挂起
  for (const fn of timers) fn();
  assert.equal(tp.pending(toolMsg), false);
});

test('已取消/出错的回合不会被 release 揭示未出现的工具', () => {
  const { tp, store } = harness();
  const cancelled = { ...toolMsg, cancelled: true };
  store.set('a1', cancelled);
  tp.watch(cancelled);
  tp.project(cancelled);
  tp.release();
  assert.equal(tp.project(cancelled, { advance: false }).toolCalls.length, 1);
});
