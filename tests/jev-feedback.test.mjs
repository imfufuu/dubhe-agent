// Jev 决策层：上一轮上下文（第 2 项）与决策反馈闭环（第 5 项）的纯函数与接线
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import * as jev from '../js/jev.js';

test('mergeJevOutcome：只追加 outcome，保留 summary / route；布尔值覆盖旧值；jev 缺失也可用', () => {
  const a = jev.mergeJevOutcome({ summary: 'tools · 难度 2', route: 'tools', needSearch: 0.2 }, { usedTools: true });
  assert.equal(a.summary, 'tools · 难度 2');
  assert.equal(a.route, 'tools');
  assert.deepEqual(a.outcome, { usedTools: true });
  const b = jev.mergeJevOutcome(a, { regenerated: true });
  assert.deepEqual(b.outcome, { usedTools: true, regenerated: true }, '多次标记累加');
  const c = jev.mergeJevOutcome(b, { regenerated: false });
  assert.equal(c.outcome.regenerated, false, '后写覆盖');
  const d = jev.mergeJevOutcome(undefined, { stopped: true });
  assert.deepEqual(d, { outcome: { stopped: true } });
  assert.equal(a.summary, 'tools · 难度 2', '不修改原对象');
});

test('describePreviousTurn：无上一轮返回空；含原文、预测与实际结果；原文截断到 300 字', () => {
  assert.equal(jev.describePreviousTurn(null), '');
  const s = jev.describePreviousTurn({ text: '写个爬虫', summary: 'tools · 难度 3', outcome: { usedTools: true, regenerated: true, stopped: true } });
  assert.match(s, /Previous turn: user said "写个爬虫"/);
  assert.match(s, /Jev had predicted: tools · 难度 3/);
  assert.match(s, /the agent used tools/);
  assert.match(s, /asked to regenerate/);
  assert.match(s, /stopped the turn early/);
  const long = jev.describePreviousTurn({ text: 'x'.repeat(1000) });
  assert.ok(long.length < 340, `截断后应很短（实际 ${long.length}）`);
  assert.equal(jev.describePreviousTurn({ text: '' }).includes('(empty)'), true);
});

test('buildTurnState：不传上一轮时与旧版逐字一致；传入时追加一行', () => {
  const base = jev.buildTurnState({ text: '继续', model: 'gpt-6-luna', settings: { webEnabled: true, sandboxEnabled: true } });
  assert.equal(base, 'Chat model: gpt-6-luna. Web search toggle: on. Code sandbox: on.\nUser request:\n继续');
  const withPrev = jev.buildTurnState({ text: '继续', model: 'gpt-6-luna', settings: { webEnabled: true, sandboxEnabled: true }, previous: { text: '写个爬虫', outcome: { usedTools: true } } });
  assert.equal(withPrev.split('\n').length, base.split('\n').length + 1);
  assert.match(withPrev, /Previous turn: user said "写个爬虫"; the agent used tools\./);
});

test('planTurn：previous 透传到决策请求的 state（第 2 项），并参与缓存键', async () => {
  jev.clearPlanCache();
  const real = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ model: 'jev-1.14.0', answers: { route: { type: 'choice', choice: 'chat', confidence: 0.8 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await jev.planTurn({ apiKey: 'k', text: '继续', model: 'm', settings: {}, previous: { text: '写个爬虫', outcome: { usedTools: true } } });
    await jev.planTurn({ apiKey: 'k', text: '继续', model: 'm', settings: {}, previous: null });
    assert.equal(bodies.length, 2, '上一轮不同 → 缓存键不同，两次都请求');
    assert.match(bodies[0].state, /Previous turn: user said "写个爬虫"/);
    assert.doesNotMatch(bodies[1].state, /Previous turn/);
  } finally { globalThis.fetch = real; jev.clearPlanCache(); }
});

test('接线：agent.js 经 jev-feedback.js 在工具 / 中止 / 重新生成三处记录结果，且决策写入保留 outcome', () => {
  const src = fsp.readFileSync(new URL('../js/agent.js', import.meta.url), 'utf8');
  assert.match(src, /markJevOutcome\(store, currentTurnUserId, \{ usedTools: true \}\);/);
  assert.match(src, /markJevOutcome\(store, currentTurnUserId, \{ stopped: true \}\); ctrl\.abort\(\);/);
  assert.match(src, /markLastUserOutcome\(store, \{ regenerated: true \}\);/);
  assert.match(src, /jev: \{ \.\.\.\(lastUser\.jev \|\| \{\}\), summary: plan\.summary/, '决策写入保留 outcome');
  assert.match(src, /previous: tc\.previous,/);
  assert.match(src, /from '\.\/jev-feedback\.js'/);
});
