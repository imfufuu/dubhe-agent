import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { MODELS } from '../workers-ai/worker.js';
import { getGateway, isModelForGateway, filterGatewayChatModels } from '../js/gateway-registry.js';
import { streamChat, fetchModels, authHeaders } from '../js/api.js';

function setup(ai) { return { env: { AI: { run: ai } } }; }
const model = '@cf/openai/gpt-oss-20b';
const request = (body, ip = '192.0.2.4') => new Request('https://x.workers.dev/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) });
const body = { model, messages: [{ role: 'user', content: 'hello' }], stream: true };
const usage = { prompt_tokens: 100, completion_tokens: 20 };

test('keyless gateway accepts hosted models only and keeps configured URL separate', () => {
  assert.equal(getGateway('cloudflare').noKey, true);
  assert.equal(isModelForGateway('cloudflare', model), true);
  assert.equal(isModelForGateway('cloudflare', '@openai/gpt-4'), false);
  assert.deepEqual(filterGatewayChatModels('cloudflare', [model, 'gpt-4o']), [model]);
  assert.deepEqual(authHeaders('openai', '', 'cloudflare'), {});
});
test('real client -> gateway -> SSE normalizes output and function calls', async () => {
  let seen;
  const { env } = setup(async (id, input) => { seen = { id, input }; return { response: '你好', tool_calls: [{ name: 'ping', arguments: { x: 1 } }], usage }; });
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers); headers.set('CF-Connecting-IP', '192.0.2.4');
    return worker.fetch(new Request(url, { ...options, headers }), env);
  };
  try {
    const models = await fetchModels('', undefined, { gatewayId: 'cloudflare', gatewayBaseUrl: 'https://test.workers.dev' });
    assert.ok(models.includes(model));
    const events = [];
    await streamChat({ model, apiKey: '', gatewayId: 'cloudflare', gatewayBaseUrl: 'https://test.workers.dev', messages: [{ role: 'user', text: 'hello' }], tools: [{ name: 'ping', description: 'test', parameters: { type: 'object', properties: { x: { type: 'number' } } } }], onEvent: e => events.push(e) });
    assert.equal(seen.id, model); assert.equal(seen.input.stream, false);
    assert.ok(events.some(e => e.type === 'text' && e.text.includes('你好')));
    assert.ok(events.some(e => e.type === 'tool_delta' && e.name === 'ping' && e.argsText === '{"x":1}'));
  } finally { globalThis.fetch = prev; }
});
test('rejects unknown model and missing AI binding, without requiring quota or IP', async () => {
  let count = 0; const { env } = setup(async () => { count++; return { response: 'ok' }; });
  assert.equal((await worker.fetch(request({ ...body, model: '@openai/gpt-4' }), env)).status, 400);
  const noIp = new Request('https://x.workers.dev/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await worker.fetch(noIp, env)).status, 200);
  assert.equal((await worker.fetch(request(body), {})).status, 503);
  assert.equal(count, 1);
});
test('no application daily quota blocks repeated requests', async () => {
  let count = 0; const { env } = setup(async () => { count++; return { response: 'ok', usage }; });
  const results = await Promise.all(Array.from({ length: 130 }, () => worker.fetch(request(body), env)));
  assert.ok(results.every(r => r.status === 200));
  assert.equal(count, 130);
});
test('upstream 429 remains distinguishable from removed application quota', async () => {
  const { env } = setup(async () => { throw Object.assign(new Error('rate limit'), { status: 429 }); });
  const res = await worker.fetch(request(body), env);
  assert.equal(res.status, 429);
  assert.match((await res.json()).error.message, /Cloudflare/);
});
test('client never automatically replays an ambiguous Workers AI failure', async () => {
  const old = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('uncertain', { status: 502 }); };
  try {
    await assert.rejects(streamChat({ model, apiKey: '', gatewayId: 'cloudflare', gatewayBaseUrl: 'https://test.workers.dev', messages: [{ role: 'user', text: 'hello' }], onEvent() {} }));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = old; }
});

import { CF_CHAT_MODELS, CF_DISABLED_PAID, CF_IMAGE_MODEL, CF_VISION_MODEL, CF_DECISION_MODELS, cfChatAvailable } from '../js/cloudflare-ai-catalog.js';
import { analyzeImage } from '../js/vision.js';
import { generateImage } from '../js/api.js';
import { resolveImageVariant, imageModelRuntimeDescription } from '../js/config.js';
const post = (path, payload, ip = '192.0.2.4') => new Request(`https://x.workers.dev${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(payload) });

test('catalog keeps paid models disabled, deprecations enforced, non-agent models refuse tools', async () => {
  const { env } = setup(async () => ({ response: 'ok', usage }));
  for (const id of CF_DISABLED_PAID) assert.equal((await worker.fetch(request({ ...body, model: id }), env)).status, 400);
  assert.equal(cfChatAvailable('constructor'), false);
  assert.equal(cfChatAvailable('@cf/qwen/qwen3-30b-a3b-fp8', new Date('2026-11-20T00:00:00Z')), false);
  assert.ok(Object.keys(CF_CHAT_MODELS).length > 2);
  assert.equal((await worker.fetch(request({ ...body, model: '@cf/qwen/qwq-32b', tools: [{ type: 'function', function: { name: 'x' } }] }), env)).status, 400);
  const catalog = await (await worker.fetch(new Request('https://x.workers.dev/v1/catalog'), env)).json();
  assert.ok(catalog.paid_only_disabled.includes(CF_DISABLED_PAID[0]));
});
test('native specialized routes reject other IDs and URLs', async () => {
  let calls = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZYAAAAASUVORK5CYII=', 'base64').toString('base64');
  const { env } = setup(async (id, input) => {
    calls.push({ id, input });
    if (id === CF_IMAGE_MODEL) return { image: png };
    if (id === CF_VISION_MODEL) return { answer: '一张图', metrics: { input_tokens: 100, output_tokens: 10 } };
    return { answers: { a: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 0 } };
  });
  assert.equal((await worker.fetch(post('/v1/vision', { model: CF_VISION_MODEL, image: 'https://example.com/x', prompt: 'x' }), env)).status, 400);
  assert.equal((await worker.fetch(post('/v1/decisions', { model: 'constructor', state: 'x', questions: { a: {} } }), env)).status, 400);
  assert.equal((await worker.fetch(post('/v1/images/generations', { model: CF_DISABLED_PAID[0], prompt: 'x' }), env)).status, 400);
  const image = await worker.fetch(post('/v1/images/generations', { model: CF_IMAGE_MODEL, prompt: 'x' }), env);
  assert.equal(image.status, 200); assert.equal((await image.json()).data[0].b64_json, png);
  const vision = await worker.fetch(post('/v1/vision', { model: CF_VISION_MODEL, image: `data:image/png;base64,${png}`, prompt: 'describe' }), env);
  assert.equal(vision.status, 200); assert.equal((await vision.json()).text, '一张图');
  const decision = await worker.fetch(post('/v1/decisions', { model: '@cf/cloudflare/clef-flash', state: 'hello', questions: { a: { type: 'noul', instructions: 'ok?' } } }), env);
  assert.equal(decision.status, 200); assert.equal(calls[2].input.model, 'clef-flash');
  assert.equal(calls[0].input.steps, 4);
  for (const id of Object.keys(CF_DECISION_MODELS)) assert.ok(id.startsWith('@cf/cloudflare/'));
});
test('specialized ambiguous failure is not replayed by clients', async () => {
  let calls = 0;
  const { env } = setup(async () => { calls++; throw Error('lost'); });
  assert.equal((await worker.fetch(post('/v1/decisions', { model: '@cf/cloudflare/clairic', state: 'x', fields: { a: { type: 'text' } } }), env)).status, 502);
  assert.equal(calls, 1);
  const old = globalThis.fetch; let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response('ambiguous', { status: 502 }); };
  try {
    await assert.rejects(analyzeImage({ apiKey: '', gatewayId: 'cloudflare', gatewayBaseUrl: 'https://test.workers.dev', dataUrl: 'data:image/png;base64,aGVsbG8=', prompt: 'test' }));
    assert.equal(fetches, 1);
    await assert.rejects(generateImage({ model: CF_IMAGE_MODEL, apiKey: '', gatewayId: 'cloudflare', gatewayBaseUrl: 'https://test.workers.dev', prompt: 'test' }));
    assert.equal(fetches, 2);
  } finally { globalThis.fetch = old; }
});
test('Cloudflare image family resolves without substituting another provider', () => {
  assert.equal(resolveImageVariant('cloudflare-flux'), CF_IMAGE_MODEL);
  assert.match(imageModelRuntimeDescription('cloudflare-flux', { gatewayId: 'cloudflare' }), /flux-1-schnell/);
  assert.match(imageModelRuntimeDescription('cloudflare-flux', { gatewayId: 'openai' }), /没有可用变体/);
});
test('image and vision clients use native endpoints with no authentication', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZYAAAAASUVORK5CYII=';
  const { env } = setup(async id => id === CF_IMAGE_MODEL ? { image: png } : { answer: 'seen', metrics: { input_tokens: 10, output_tokens: 2 } });
  const old = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts }); const headers = new Headers(opts.headers); headers.set('CF-Connecting-IP', '192.0.2.4');
    return worker.fetch(new Request(url, { ...opts, headers }), env);
  };
  try {
    const args = { apiKey: '', gatewayId: 'cloudflare', gatewayBaseUrl: 'https://test.workers.dev' };
    const img = await generateImage({ ...args, model: CF_IMAGE_MODEL, prompt: 'test' });
    assert.match(img.dataUrl, /^data:image\/png;base64,/);
    assert.equal(await analyzeImage({ ...args, prompt: 'describe', dataUrl: `data:image/png;base64,${png}`, model: CF_VISION_MODEL }), 'seen');
    assert.match(calls[0].url, /\/v1\/images\/generations$/);
    assert.match(calls[1].url, /\/v1\/vision$/);
    assert.equal(calls[1].opts.redirect, 'error');
    assert.equal(new Headers(calls[0].opts.headers).has('Authorization'), false);
  } finally { globalThis.fetch = old; }
});
