// 2026-11-08 Workers AI 网关修复回归：完整模型列表、function tools 双格式降级、
// 不再误报 400 的参数规范化、供应商/Neurons 费率卡片与安全边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers-ai/worker.js';
import { CF_CHAT_MODELS, CF_AGENT_CHAT_IDS, cfChatAvailable, cfCanonicalModelId, cfModelCard } from '../js/cloudflare-ai-catalog.js';
import { providerOf } from '../js/config.js?v=2026.10.25.1';
import { priceBadgeFor, estimateChatCost } from '../js/pricing.js';
import { gatewayFallbackModels, isModelForGateway, gatewayAgentToolModelIds } from '../js/gateway-registry.js?v=2026.10.25.1';

const model = '@cf/openai/gpt-oss-20b';
const req = (body, path = '/v1/chat/completions') => new Request(`https://x.workers.dev${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const chat = { model, messages: [{ role: 'user', content: 'hello' }] };
const envFor = (run) => ({ env: { AI: { run } } });

test('GET /v1/models lists every enabled hosted model with provider and capability flags', async () => {
  const res = await worker.fetch(new Request('https://x.workers.dev/v1/models'), { env: {} });
  const list = (await res.json()).data;
  const expected = Object.keys(CF_CHAT_MODELS).filter(id => cfChatAvailable(id));
  assert.equal(list.length, expected.length);
  assert.ok(list.length > CF_AGENT_CHAT_IDS.length, 'chat-only models must be listed too');
  for (const item of list) {
    assert.equal(item.owned_by, 'cloudflare');
    assert.equal(item.provider, 'Cloudflare');
    assert.equal(typeof item.agent_tools, 'boolean');
    assert.ok(item.display_name);
  }
  assert.ok(list.some(m => m.agent_tools === false));
  const agentOnly = await (await worker.fetch(new Request('https://x.workers.dev/v1/models?agent_tools=1'), { env: {} })).json();
  assert.equal(agentOnly.data.length, CF_AGENT_CHAT_IDS.filter(id => cfChatAvailable(id)).length);
  const health = await (await worker.fetch(new Request('https://x.workers.dev/health'), { env: {} })).json();
  assert.equal(health.ok, true);
  assert.equal(health.models, expected.length);
});

test('function tools retry the other Cloudflare schema exactly once on a 4xx schema rejection', async () => {
  const calls = [];
  const { env } = envFor(async (id, input) => {
    calls.push(input.tools);
    if (calls.length === 1) throw Object.assign(new Error('invalid tools schema'), { status: 400 });
    return { response: 'done', usage: { prompt_tokens: 1 } };
  });
  const res = await worker.fetch(req({ ...chat, tools: [{ type: 'function', function: { name: 'ping', description: 'p', parameters: { type: 'object', properties: {} } } }] }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0].type, 'function');
  assert.equal(calls[1][0].type, undefined);
  assert.equal(calls[1][0].name, 'ping');
  assert.match(await res.text(), /"content":"done"/);
});

test('ambiguous inference failures are never replayed and are diagnosable', async () => {
  let calls = 0;
  const { env } = envFor(async () => { calls++; throw new Error('upstream gateway saturation'); });
  const res = await worker.fetch(req({ ...chat, tools: [{ type: 'function', function: { name: 'ping' } }] }), env);
  assert.equal(res.status, 502);
  assert.equal(calls, 1);
  assert.match((await res.json()).error.message, /upstream gateway saturation/);
});

test('parameter normalisation removes unexpected HTTP 400 responses', async () => {
  let seen;
  const { env } = envFor(async (id, input) => { seen = input; return { response: 'ok' }; });
  const res = await worker.fetch(req({
    model: '@CF/OpenAI/GPT-OSS-20B',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }],
    max_tokens: 999999, temperature: 7, top_p: 9, stream: true,
  }), env);
  assert.equal(res.status, 200);
  assert.equal(seen.max_tokens, 8192);
  assert.equal(seen.temperature, 2);
  assert.equal(seen.top_p, 1);
  assert.equal(seen.messages[0].content, 'first\nsecond');
  assert.equal(seen.stream, false);
  assert.equal(cfCanonicalModelId('@CF/OpenAI/GPT-OSS-20B'), model);
});

test('specialised endpoints accept case-insensitive model IDs', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZYAAAAASUVORK5CYII=';
  const { env } = envFor(async () => ({ answer: 'seen' }));
  const res = await worker.fetch(req({ model: '@cf/moondream/moondream3.1-9b-a2b', image: `data:image/png;base64,${png}`, prompt: 'describe' }, '/v1/vision'), env);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).text, 'seen');
});

test('reasoning-only output is surfaced instead of an empty answer', async () => {
  const { env } = envFor(async () => ({ choices: [{ message: { content: '', reasoning_content: 'internal reasoning' } }] }));
  const res = await worker.fetch(req(chat), env);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /internal reasoning/);
});

test('model cards show Cloudflare as provider, the author as vendor, and Neurons (not $0) rates', () => {
  assert.equal(providerOf(model), 'Cloudflare');
  const card = cfModelCard(model);
  assert.equal(card.provider, 'Cloudflare');
  assert.equal(card.vendor, 'OpenAI');
  assert.equal(card.agentTools, true);
  assert.equal(card.pricing, null, 'Workers AI 不计价，不再返回 Neurons 费率');
  assert.equal(priceBadgeFor(model, { language: 'en' }), '', 'Workers AI 不计价');
  const cost = estimateChatCost(model, { input: 100, output: 20 });
  assert.equal(cost.unpriced, true);
  assert.equal(cost.costUsd, 0);
  assert.match(cost.rateLabel, /不计价|unpriced|Cloudflare/i);
  const chatOnly = '@cf/qwen/qwq-32b';
  assert.equal(cfModelCard(chatOnly).agentTools, false);
  assert.equal(isModelForGateway('cloudflare', chatOnly), true);
  assert.equal(gatewayFallbackModels('cloudflare').length, Object.keys(CF_CHAT_MODELS).filter(id => cfChatAvailable(id)).length);
  assert.deepEqual(gatewayAgentToolModelIds('cloudflare'), CF_AGENT_CHAT_IDS.filter(id => cfChatAvailable(id)));
  assert.equal(isModelForGateway('cloudflare', '@openai/gpt-4'), false);
});

test('unknown models and malformed tool definitions are still rejected', async () => {
  const { env } = envFor(async () => ({ response: 'ok' }));
  assert.equal((await worker.fetch(req({ ...chat, model: '@openai/gpt-4' }), env)).status, 400);
  assert.equal((await worker.fetch(req({ ...chat, tools: [{ type: 'function', function: { name: 'bad name!' } }] }), env)).status, 400);
  assert.equal((await worker.fetch(req({ ...chat, messages: [] }), env)).status, 400);
});
