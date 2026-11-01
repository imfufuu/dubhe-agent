// Jev 决策层：回合开始等待上限（3s，fail-open）与结论缓存（同模型 + 同状态，TTL 10 分钟，最多 50 条，命中不计费）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as jev from '../js/jev.js';

const ANSWERS = {
  route: { type: 'choice', choice: 'search', confidence: 0.91 },
  need_search: { type: 'noul', noul: 0.92 },
  need_code: { type: 'noul', noul: 0.1 },
  need_image: { type: 'noul', noul: 0.05 },
  need_dispatch: { type: 'noul', noul: 0.1 },
  difficulty: { type: 'score', score: 2 },
};

function withFetch(impl, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), body: JSON.parse(opts.body) }); return impl(url, opts); };
  return Promise.resolve().then(() => fn(calls)).finally(() => { globalThis.fetch = real; jev.clearPlanCache(); jev.setActiveJevModel('jev-1.14.0'); });
}
const okJson = () => new Response(JSON.stringify({ model: 'jev-1.14.0', answers: ANSWERS, usage: { input_tokens: 40, output_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
const base = { apiKey: 'sk-teamo-test', text: '今天美元兑人民币中间价是多少？', model: 'gpt-6-luna', settings: { webEnabled: true, sandboxEnabled: true, thinking: true, reasoningLevel: 'medium' } };

test('等待上限：默认 3 秒，明确小于旧的 8 秒', () => {
  assert.equal(jev.JEV_PLAN_TIMEOUT_MS, 3000);
  assert.equal(jev.JEV_TIMEOUT_MS, 8000, '通用超时保持不变，仅回合开始路径收紧');
});

test('超时：挂起的决策请求在上限后中止，返回 fail-open 结果且不进缓存', async () => {
  jev.clearPlanCache();
  const hang = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  await withFetch(hang, async (calls) => {
    const t0 = Date.now();
    const r = await jev.planTurn({ ...base, timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'timeout');
    assert.ok(Date.now() - t0 < 2000, '不会等满默认 8 秒');
    assert.equal(calls.length, 1);
    assert.equal(jev.planCacheSize(), 0, '失败结果不缓存');
  });
});

test('缓存命中：相同模型 + 相同状态第二次不发请求，usage 为空（不重复计费）', async () => {
  jev.clearPlanCache();
  await withFetch(() => okJson(), async (calls) => {
    const a = await jev.planTurn(base);
    const b = await jev.planTurn(base);
    assert.equal(a.ok, true);
    assert.equal(a.cached, false);
    assert.ok(a.usage, '首次调用有 usage');
    assert.equal(b.ok, true);
    assert.equal(b.cached, true);
    assert.equal(b.usage, null);
    assert.equal(calls.length, 1, '命中缓存不再请求');
    assert.equal(b.route, 'search');
    assert.equal(b.summary, a.summary);
  });
});

test('设置变化：联网开关进入状态文本，改变后不命中；思考级别不进状态，命中时提示按当前设置重算', async () => {
  jev.clearPlanCache();
  await withFetch(() => okJson(), async (calls) => {
    await jev.planTurn(base);
    const web = await jev.planTurn({ ...base, settings: { ...base.settings, webEnabled: false } });
    assert.equal(web.cached, false, '联网开关属于状态文本，结论可能不同，需重新请求');
    assert.equal(calls.length, 2);
  });
  jev.clearPlanCache();
  const DISPATCH = { ...ANSWERS, need_dispatch: { type: 'noul', noul: 0.9 } };
  const dispatchResp = () => new Response(JSON.stringify({ model: 'jev-1.14.0', answers: DISPATCH }), { status: 200, headers: { 'content-type': 'application/json' } });
  await withFetch(dispatchResp, async (calls) => {
    const medium = await jev.planTurn({ ...base, settings: { ...base.settings, reasoningLevel: 'medium' } });
    const max = await jev.planTurn({ ...base, settings: { ...base.settings, reasoningLevel: 'max' } });
    assert.equal(max.cached, true, '思考级别不属于状态文本，命中缓存');
    assert.equal(calls.length, 1);
    assert.match(medium.note, /未到 Max\/Ultra/);
    assert.match(max.note, /建议主动 dispatch_subagent/);
    assert.doesNotMatch(max.note, /未到 Max\/Ultra/);
  });
});

test('键包含模型版本与状态文本：换版本或换文本都不命中', async () => {
  jev.clearPlanCache();
  await withFetch(() => okJson(), async (calls) => {
    await jev.planTurn(base);
    jev.setActiveJevModel('jev-1.13.0');
    const other = await jev.planTurn(base);
    assert.equal(other.cached, false, '换决策模型版本重新请求');
    jev.setActiveJevModel('jev-1.14.0');
    const diffText = await jev.planTurn({ ...base, text: '换一个问题' });
    assert.equal(diffText.cached, false);
    assert.equal(calls.length, 3);
  });
});

test('有效期：超过 10 分钟后失效并重新请求', async () => {
  jev.clearPlanCache();
  await withFetch(() => okJson(), async (calls) => {
    const t0 = 1_000_000;
    await jev.planTurn({ ...base, now: t0 });
    const within = await jev.planTurn({ ...base, now: t0 + jev.JEV_PLAN_CACHE_TTL_MS - 1 });
    assert.equal(within.cached, true);
    const expired = await jev.planTurn({ ...base, now: t0 + jev.JEV_PLAN_CACHE_TTL_MS + 1 });
    assert.equal(expired.cached, false);
    assert.equal(calls.length, 2);
  });
});

test('失败不缓存：HTTP 错误后下一次仍会请求', async () => {
  jev.clearPlanCache();
  let n = 0;
  const flaky = () => (++n === 1 ? new Response('{"error":{"message":"busy"}}', { status: 503, headers: { 'content-type': 'application/json' } }) : okJson());
  await withFetch(flaky, async (calls) => {
    const a = await jev.planTurn(base);
    assert.equal(a.ok, false);
    const b = await jev.planTurn(base);
    assert.equal(b.ok, true);
    assert.equal(b.cached, false);
    assert.equal(calls.length, 2);
  });
});

test('容量：超过 50 条后按最久未用淘汰', () => {
  jev.clearPlanCache();
  for (let i = 0; i < jev.JEV_PLAN_CACHE_MAX + 10; i++) jev.planCachePut(`k${i}`, { answers: {} }, 0);
  assert.equal(jev.planCacheSize(), jev.JEV_PLAN_CACHE_MAX);
  assert.equal(jev.planCacheGet('k0', 0), null, '最早的被淘汰');
  assert.ok(jev.planCacheGet(`k${jev.JEV_PLAN_CACHE_MAX + 9}`, 0), '最新的保留');
  jev.clearPlanCache();
});

test('agent.js 回合开始路径使用 3 秒上限', async () => {
  const fsp = await import('node:fs');
  const src = fsp.readFileSync(new URL('../js/agent.js', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*\bplanTurn\b[^}]*\bJEV_PLAN_TIMEOUT_MS\b[^}]*\} from '\.\/jev\.js';/);
  assert.match(src, /attachments: lastUser && lastUser\.attachments,\s*timeoutMs: JEV_PLAN_TIMEOUT_MS,/);
});
