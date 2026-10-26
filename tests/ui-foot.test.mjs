import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantFootPainter } from '../js/ui-foot.js';

function harness(message, messages = [message]) {
  const foot = { hidden: true, textContent: '', title: '' };
  const wrap = { querySelector: (selector) => selector === '.msg-foot' ? foot : null };
  const paintFoot = createAssistantFootPainter({ state: { messages } });
  paintFoot(wrap, message);
  return foot;
}

test('tool-call assistant messages never show a footer', () => {
  const message = {
    id: 'assistant-tool', role: 'assistant', done: true,
    toolCalls: [{ id: 'call-1', name: 'search_files' }],
    reasoningLevel: 'high', durationMs: 2200, ts: Date.now(),
    reasoning: 'private reasoning must not be copied into the footer',
  };
  const foot = harness(message, [{ id: 'user', role: 'user' }, message]);
  assert.equal(foot.hidden, true);
  assert.equal(foot.textContent, '');
  assert.equal(foot.title, '');
});

test('messages without renderable footer metadata stay compact', () => {
  const message = { id: 'assistant-empty', role: 'assistant', done: true, toolCalls: [{ id: 'call-2' }] };
  const foot = harness(message, [{ role: 'user' }, message]);
  assert.equal(foot.hidden, true);
  assert.equal(foot.textContent, '');
});

test('incomplete and non-assistant messages never expose assistant footer metadata', () => {
  const incomplete = harness({ id: 'assistant-live', role: 'assistant', done: false, durationMs: 1000, ts: Date.now() });
  assert.equal(incomplete.hidden, true);
  const user = harness({ id: 'user', role: 'user', done: true, durationMs: 1000, ts: Date.now() });
  assert.equal(user.hidden, true);
});
