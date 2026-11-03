// Midjourney 文生图（非官方，经 TeamoRouter /mj）、Token 构成识图栏、价格币种扩展。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IMAGE_MODELS, IMAGE_FAMILIES, imageFamilyOf, resolveImageVariant, isMidjourneyModel, imageModelRuntimeDescription } from '../js/config.js';
import { buildMjSubmitBody, parseMjSubmit, mjTaskState, generateImage } from '../js/api.js';
import { estimateImageCost } from '../js/pricing.js';
import { tokenBreakdown, formatTokBreak } from '../js/commands.js';
import { CURRENCY_PREFERENCES, setCurrencyPreference, usdToCurrency, formatCurrency } from '../js/currency.js';

test('Midjourney 进入生图列表（模型 + 家族），解析为自身 ID', () => {
  assert.ok(IMAGE_MODELS.some((m) => m.id === 'midjourney'));
  assert.ok(IMAGE_FAMILIES.some((f) => f.id === 'midjourney' && f.defaultModel === 'midjourney'));
  assert.equal(imageFamilyOf('midjourney'), 'midjourney');
  assert.equal(resolveImageVariant('midjourney', { style: 'illustration', resolution: '4K', prompt: '插画' }), 'midjourney');
  assert.equal(isMidjourneyModel('midjourney'), true);
  assert.equal(isMidjourneyModel('gpt-image-2'), false);
  assert.match(imageModelRuntimeDescription('midjourney'), /仅文生图/);
});

test('提交请求体与官方示例逐字段一致', () => {
  assert.equal(
    buildMjSubmitBody('An orange cat typing on a keyboard --ar 1:1'),
    '{"model":"mj_imagine","botType":"MID_JOURNEY","prompt":"An orange cat typing on a keyboard --ar 1:1"}',
  );
});

test('受理判定：code 1/22 + 合法 task_id；其余一律拒绝', () => {
  assert.deepEqual(parseMjSubmit({ code: 1, result: 'abc_-123' }), { ok: true, taskId: 'abc_-123' });
  assert.deepEqual(parseMjSubmit({ code: 22, result: 12345 }), { ok: true, taskId: '12345' });
  assert.equal(parseMjSubmit({ code: 0, result: 'abc' }).ok, false);
  assert.equal(parseMjSubmit({ code: 1, result: 'a b' }).ok, false);
  assert.equal(parseMjSubmit({ code: 1, result: -1 }).ok, false);
  assert.equal(parseMjSubmit({ code: 1, result: true }).ok, false);
  assert.equal(parseMjSubmit({ code: '1', result: 'abc' }).ok, false, 'code 必须是整数');
  assert.equal(parseMjSubmit({ code: 1, result: 'x'.repeat(129) }).ok, false);
});

test('任务状态：SUCCESS 完成；FAILURE/CANCEL 失败；其余继续轮询', () => {
  assert.equal(mjTaskState({ status: 'SUCCESS' }), 'done');
  assert.equal(mjTaskState({ status: 'FAILURE' }), 'failed');
  assert.equal(mjTaskState({ status: 'CANCEL' }), 'failed');
  assert.equal(mjTaskState({ status: 'IN_PROGRESS' }), 'pending');
});

test('生图端到端（桩 fetch）：只 POST 一次，轮询到 SUCCESS 返回 imageUrl', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
    if (String(url).endsWith('/mj/submit/imagine')) return new Response(JSON.stringify({ code: 1, result: 'task-9' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ status: 'SUCCESS', imageUrl: 'https://cdn.example/cat.png' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const out = await generateImage({ model: 'midjourney', apiKey: 'k', prompt: 'orange cat', size: '16:9' });
    const posts = calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/mj\/submit\/imagine$/);
    assert.equal(posts[0].body, '{"model":"mj_imagine","botType":"MID_JOURNEY","prompt":"orange cat --ar 16:9"}');
    assert.ok(calls.some((c) => /\/mj\/task\/task-9\/fetch$/.test(c.url)));
    assert.equal(out.images[0].dataUrl, 'https://cdn.example/cat.png');
    assert.equal(out.taskId, 'task-9');
  } finally { globalThis.fetch = realFetch; }
});

test('提交失败（HTTP 500）不自动重提', async () => {
  const realFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST') posts++;
    return new Response('boom', { status: 500 });
  };
  try {
    await assert.rejects(generateImage({ model: 'midjourney', apiKey: 'k', prompt: 'cat' }));
    assert.equal(posts, 1, '只提交一次');
  } finally { globalThis.fetch = realFetch; }
});

test('定价：Midjourney 每任务 $0.079，每次调用按 1 张', () => {
  const r = estimateImageCost({ model: 'midjourney', size: 'auto', quality: 'auto', count: 1 });
  assert.ok(Math.abs(r.costUsd - 0.079) < 1e-9, String(r.costUsd));
});

test('Token 构成：看图类工具结果单列为「识图」，合计不变', () => {
  const msgs = [
    { role: 'user', text: 'a' },
    { role: 'tool', name: 'analyze_image', content: 'x' },
    { role: 'tool', name: 'read_file', content: 'y' },
    { role: 'user', text: 'b' },
  ];
  const est = (arr) => arr.reduce((s, m) => s + (m.content ? 10 : 5), 0);
  const b = tokenBreakdown(msgs, est, 7);
  assert.equal(b.vision, 10);
  assert.equal(b.tools, 10);
  assert.equal(b.total, b.system + b.history + b.tools + b.vision + b.current);
  assert.match(formatTokBreak(b), /识图 10/);
});

test('币种：新增 EUR / JPY / GBP / HKD / KRW，换算与格式化正确', () => {
  for (const c of ['EUR', 'JPY', 'GBP', 'HKD', 'KRW']) assert.ok(CURRENCY_PREFERENCES.includes(c), c);
  assert.ok(Math.abs(usdToCurrency(1, 'EUR') - 0.8916) < 0.0005);
  assert.ok(Math.abs(usdToCurrency(1, 'JPY') - 157.9) < 0.05);
  assert.ok(Number.isNaN(usdToCurrency(1, 'XXX')));
  setCurrencyPreference('JPY');
  try {
    assert.match(formatCurrency(1, 'en'), /¥|JP¥/);
    assert.doesNotMatch(formatCurrency(1, 'en'), /\./, '日元不带小数');
  } finally { setCurrencyPreference('auto'); }
});

test('设置页与界面文案覆盖新币种', () => {
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  for (const c of ['EUR', 'JPY', 'GBP', 'HKD', 'KRW']) assert.match(html, new RegExp(`<option value="${c}">`));
});
