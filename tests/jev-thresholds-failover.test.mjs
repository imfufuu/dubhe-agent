// Jev 决策阈值（第 4 项：锁定数值与边界、遥测信号）+ 共用网关故障转移（第 6 项：Jev 与自动审批）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs';
import * as jev from '../js/jev.js';
import * as ep from '../js/endpoint.js';
import * as ar from '../js/auto-review.js';

const TYPE_ERR = () => new TypeError('Failed to fetch');
const okJson = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json' } });

test('阈值：数值锁定（重构后与原字面量逐一相同），且只读', () => {
  assert.deepEqual({ ...jev.JEV_THRESHOLDS }, {
    chip: 0.55, searchStrong: 0.65, searchWeak: 0.25, image: 0.6, codeStrong: 0.6,
    codeWeak: 0.25, dispatchWeak: 0.3, dispatchStrong: 0.7, difficultyHard: 4,
  });
  assert.equal(Object.isFrozen(jev.JEV_THRESHOLDS), true);
});

test('阈值边界：摘要标签 0.55 命中、0.549 不命中', () => {
  const at = jev.summarizePlan({ route: { choice: 'tools' }, need_search: { noul: 0.55 }, need_code: { noul: 0.549 }, need_image: {}, need_dispatch: {} });
  assert.match(at, /检索/);
  assert.doesNotMatch(at, /沙箱/);
});

test('阈值边界：强制检索 0.65 触发、0.6499 不触发；难度 4 触发、3.99 不触发', () => {
  const base = { route: { choice: 'chat' }, need_code: { noul: 0.1 }, need_image: { noul: 0.1 }, need_dispatch: { noul: 0.1 } };
  const note = (search, diff) => jev.formatPlanNote({ ...base, need_search: { noul: search }, difficulty: { score: diff } }, { webEnabled: true, sandboxEnabled: true, thinking: true, reasoningLevel: 'medium' });
  assert.match(note(0.65, 2), /工具表提供 search_web/);
  assert.doesNotMatch(note(0.6499, 2), /工具表提供 search_web/);
  assert.match(note(0.1, 4), /高难度/);
  assert.doesNotMatch(note(0.1, 3.99), /高难度/);
});

test('遥测信号：只含数值与路由，保留两位小数，不含用户文本；失败时记原因', () => {
  const sig = jev.planSignals({ ok: true, route: 'tools', routeConfidence: 0.8567, needSearch: 0.1, needCode: 0.9, needImage: null, needDispatch: 0.5, difficulty: 3.456, cached: true, summary: '含原文的摘要', note: '提示正文' });
  assert.deepEqual(sig, { ok: true, route: 'tools', routeConfidence: 0.86, needSearch: 0.1, needCode: 0.9, needImage: null, needDispatch: 0.5, difficulty: 3.46, cached: true });
  assert.equal(JSON.stringify(sig).includes('含原文'), false);
  assert.deepEqual(jev.planSignals({ ok: false, reason: 'timeout' }), { ok: false, reason: 'timeout' });
  assert.deepEqual(jev.planSignals(null), { ok: false, reason: 'none' });
});

test('共用封装：网络错误才换域名；成功后记住新域名（非注入时）', async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); if (seen.length === 1) throw TYPE_ERR(); return okJson({ ok: true }); };
  const res = await ep.postWithGatewayFailover('/v1/x', { method: 'POST' }, { fetchImpl, base: 'https://a.example', fallback: 'https://b.example' });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, ['https://a.example/v1/x', 'https://b.example/v1/x']);
});

test('共用封装：HTTP 错误不换域名（只有网络层错误才换）', async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return new Response('{}', { status: 503 }); };
  const res = await ep.postWithGatewayFailover('/v1/x', { method: 'POST' }, { fetchImpl, base: 'https://a.example', fallback: 'https://b.example' });
  assert.equal(res.status, 503);
  assert.equal(seen.length, 1);
});

test('共用封装：用户中止直接抛出，不换域名', async () => {
  const ctrl = new AbortController(); ctrl.abort();
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  await assert.rejects(ep.postWithGatewayFailover('/v1/x', { signal: ctrl.signal }, { fetchImpl, base: 'https://a.example', fallback: 'https://b.example' }), (e) => e.name === 'AbortError');
  assert.equal(seen.length, 1);
});

test('自动审批：首选域名网络失败后换到另一个域名，仍得到结论', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (seen.length === 1) throw TYPE_ERR();
    return okJson({ output_text: JSON.stringify({ outcome: 'allow', rationale: 'ok', risk_level: 'low', user_authorization: 'explicit' }) });
  };
  const r = await ar.reviewToolCall({ apiKey: 'k', call: { name: 'write_file', args: {} }, risk: { level: 'L2', reasons: [] }, fetchImpl, base: 'https://a.example', fallback: 'https://b.example' });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'allow');
  assert.deepEqual(seen, ['https://a.example/v1/responses', 'https://b.example/v1/responses']);
});

test('Jev：决策请求同样走共用封装（网络失败换域名后仍得到结论）', async () => {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (seen.length === 1) throw TYPE_ERR();
    return okJson({ model: 'jev-1.14.0', answers: { route: { type: 'choice', choice: 'chat', confidence: 0.7 } } });
  };
  try {
    const before = ep.gatewayBase();
    const r = await jev.askJev({ apiKey: 'k', state: 'hi', questions: jev.TURN_QUESTIONS });
    assert.equal(r.ok, true);
    assert.equal(seen.length, 2);
    assert.match(seen[0], /\/v1\/systemone$/);
    assert.match(seen[1], /\/v1\/systemone$/);
    assert.notEqual(seen[0].split('/v1')[0], seen[1].split('/v1')[0], '第二次请求换到了另一个域名');
    ep.setGatewayBase(before, 'manual');
  } finally { globalThis.fetch = real; }
});

test('接线：agent 记录 planSignals；jev 与 auto-review 均经共用封装', () => {
  const agent = fsp.readFileSync(new URL('../js/agent.js', import.meta.url), 'utf8');
  assert.match(agent, /telemetry\.recordLayer\('L1-jev', Date\.now\(\) - jevT0, planSignals\(plan\)\);/);
  const jevSrc = fsp.readFileSync(new URL('../js/jev.js', import.meta.url), 'utf8');
  assert.match(jevSrc, /postWithGatewayFailover\(JEV_PATH/);
  const arSrc = fsp.readFileSync(new URL('../js/auto-review.js', import.meta.url), 'utf8');
  assert.match(arSrc, /postWithGatewayFailover\(AUTO_REVIEW_PATH/);
});
