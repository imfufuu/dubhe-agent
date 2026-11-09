// 全项目鉴权：客户端网关令牌不覆盖 API Key、不进会话导出；Workers AI 网关可强制校验令牌与 Origin。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../workers-ai/worker.js';
import { authHeaders } from '../js/api.js';
import {
  gatewayTokenKey, readGatewayToken, writeGatewayToken, gatewayAuthHeader, mergeGatewayAuth,
} from '../js/gateway-auth.js';

const root = new URL('../', import.meta.url);
const read = (rel) => fs.readFileSync(new URL(rel, root), 'utf8');
const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
};

test('网关令牌按网关隔离、可清除，且不写入 store 结构', () => {
  const storage = memoryStorage();
  assert.equal(readGatewayToken('cloudflare', storage), '');
  writeGatewayToken('cloudflare', '  secret-token  ', storage);
  assert.equal(readGatewayToken('cloudflare', storage), 'secret-token');
  assert.equal(readGatewayToken('custom', storage), '');
  assert.equal(gatewayTokenKey('cloudflare'), 'dubhe-gateway-token:cloudflare');
  assert.deepEqual(gatewayAuthHeader('cloudflare', storage), { Authorization: 'Bearer secret-token' });
  writeGatewayToken('cloudflare', '', storage);
  assert.equal(readGatewayToken('cloudflare', storage), '');
  assert.deepEqual(gatewayAuthHeader('cloudflare', storage), {});
  // 超长输入被截断；含非法字符的 gatewayId 不会污染键名
  writeGatewayToken('cloudflare', 'x'.repeat(2000), storage);
  assert.equal(readGatewayToken('cloudflare', storage).length, 512);
  assert.equal(gatewayTokenKey('../../etc'), 'dubhe-gateway-token:....etc');
});

test('mergeGatewayAuth 只在请求尚无凭据时注入令牌', () => {
  const storage = memoryStorage({ 'dubhe-gateway-token:cloudflare': 'shared' });
  assert.deepEqual(mergeGatewayAuth({}, 'cloudflare', storage), { Authorization: 'Bearer shared' });
  assert.deepEqual(mergeGatewayAuth({ 'Content-Type': 'application/json' }, 'cloudflare', storage),
    { Authorization: 'Bearer shared', 'Content-Type': 'application/json' });
  // 已有 API Key / Anthropic / Gemini 凭据时绝不覆盖
  assert.deepEqual(mergeGatewayAuth({ Authorization: 'Bearer sk-user' }, 'cloudflare', storage), { Authorization: 'Bearer sk-user' });
  assert.deepEqual(mergeGatewayAuth({ 'x-api-key': 'sk-ant' }, 'cloudflare', storage), { 'x-api-key': 'sk-ant' });
  assert.deepEqual(mergeGatewayAuth({ 'x-goog-api-key': 'AIza' }, 'cloudflare', storage), { 'x-goog-api-key': 'AIza' });
  assert.deepEqual(mergeGatewayAuth({ Accept: 'text/event-stream' }, 'custom', storage), { Accept: 'text/event-stream' });
});

test('authHeaders：无 Key 网关用访问令牌，其余网关保持原有鉴权头', () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = memoryStorage({ 'dubhe-gateway-token:cloudflare': 'shared', 'dubhe-gateway-token:custom': 'shared-custom' });
  try {
    assert.deepEqual(authHeaders('openai', '', 'cloudflare'), { Authorization: 'Bearer shared' });
    assert.equal(authHeaders('openai', 'sk-user').Authorization, 'Bearer sk-user');
    assert.equal(authHeaders('anthropic', 'sk-ant')['x-api-key'], 'sk-ant');
    assert.equal(authHeaders('gemini-native', 'AIza', 'gemini')['x-goog-api-key'], 'AIza');
    assert.equal(authHeaders('openai', '', 'custom').Authorization, 'Bearer shared-custom'); // 自定义网关未填 API Key 时用其共享令牌
  } finally {
    if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous;
  }
});

// ── Workers AI 网关服务端鉴权 ──
const chatRequest = (headers = {}) => new Request('https://x.workers.dev/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ model: '@cf/openai/gpt-oss-20b', messages: [{ role: 'user', content: 'hi' }] }),
});
const envWith = (extra = {}) => ({ AI: { run: async () => ({ response: 'ok' }) }, ...extra });
const TOKEN = 'gateway-secret-2026';

test('未配置 GATEWAY_TOKEN 时网关保持公开，且 /health 明确报告未开启鉴权', async () => {
  const res = await worker.fetch(chatRequest(), envWith());
  assert.equal(res.status, 200);
  const health = await (await worker.fetch(new Request('https://x.workers.dev/health'), envWith())).json();
  assert.equal(health.auth_required, false);
  assert.equal(health.origin_restricted, false);
});

test('配置 GATEWAY_TOKEN 后，缺少/错误的令牌一律 401 且不回显令牌', async () => {
  const env = envWith({ GATEWAY_TOKEN: TOKEN });
  for (const headers of [{}, { Authorization: 'Bearer wrong' }, { 'X-Dubhe-Gateway-Token': 'wrong' }]) {
    const res = await worker.fetch(chatRequest(headers), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'gateway_token_required');
    assert.ok(!JSON.stringify(body).includes(TOKEN), '错误响应不得回显令牌');
    assert.match(res.headers.get('www-authenticate') || '', /Bearer/);
  }
  const models = await worker.fetch(new Request('https://x.workers.dev/v1/models'), env);
  assert.equal(models.status, 401, '模型列表同样需要鉴权');
});

test('正确令牌（Bearer 或专用头）可访问推理与模型列表；健康检查仍公开', async () => {
  const env = envWith({ GATEWAY_TOKEN: TOKEN });
  for (const headers of [{ Authorization: `Bearer ${TOKEN}` }, { 'X-Dubhe-Gateway-Token': TOKEN }]) {
    const res = await worker.fetch(chatRequest(headers), env);
    assert.equal(res.status, 200);
  }
  const models = await worker.fetch(new Request('https://x.workers.dev/v1/models', { headers: { Authorization: `Bearer ${TOKEN}` } }), env);
  assert.equal(models.status, 200);
  const health = await (await worker.fetch(new Request('https://x.workers.dev/health'), env)).json();
  assert.equal(health.ok, true);
  assert.equal(health.auth_required, true);
});

test('OPTIONS 预检放行 Authorization 头；Origin 白名单拒绝跨站并回显允许的源', async () => {
  const env = envWith({ GATEWAY_TOKEN: TOKEN, ALLOWED_ORIGINS: 'https://imfufuu.github.io' });
  const preflight = await worker.fetch(new Request('https://x.workers.dev/v1/chat/completions', {
    method: 'OPTIONS', headers: { Origin: 'https://imfufuu.github.io', 'Access-Control-Request-Headers': 'authorization, content-type' },
  }), env);
  assert.equal(preflight.status, 204);
  const allowHeaders = preflight.headers.get('access-control-allow-headers') || '';
  assert.match(allowHeaders, /Authorization/i);
  assert.match(allowHeaders, /X-Dubhe-Gateway-Token/i);
  const bad = await worker.fetch(chatRequest({ Origin: 'https://evil.example', Authorization: `Bearer ${TOKEN}` }), env);
  assert.equal(bad.status, 403);
  const good = await worker.fetch(chatRequest({ Origin: 'https://imfufuu.github.io', Authorization: `Bearer ${TOKEN}` }), env);
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://imfufuu.github.io');
  assert.match(good.headers.get('vary') || '', /Origin/);
  const badPreflight = await worker.fetch(new Request('https://x.workers.dev/v1/chat/completions', {
    method: 'OPTIONS', headers: { Origin: 'https://evil.example' },
  }), env);
  assert.equal(badPreflight.status, 403);
});

test('接线与文档：设置页、API 客户端、Worker、部署配置与鉴权矩阵齐全', () => {
  assert.match(read('app.html'), /id="set-gateway-token"/);
  assert.match(read('app.html'), /id="set-gateway-token-clear"/);
  assert.match(read('js/api.js'), /mergeGatewayAuth\(inputHeaders, gatewayId\)/);
  assert.match(read('js/api.js'), /gatewayAuthHeader\(gatewayId\)/);
  assert.match(read('js/settings.js'), /writeGatewayToken\(id, gatewayTokenInput\.value\)/);
  assert.match(read('workers-ai/worker.js'), /GATEWAY_TOKEN/);
  assert.match(read('workers-ai/worker.js'), /ALLOWED_ORIGINS/);
  assert.match(read('workers-ai/wrangler.toml'), /GATEWAY_TOKEN/);
  assert.match(read('AUTH_MATRIX.md'), /Cloudflare Access/);
  assert.match(read('AUTH_MATRIX.md'), /server\.py/);
  assert.match(read('workers-ai/README.md'), /GATEWAY_TOKEN/);
});
