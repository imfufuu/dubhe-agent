// 第 11 条：防人机。Worker 侧（未配置时透明、配置后按需挑战、HMAC 通行证）与客户端透明/重试逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../relay/worker.js';
import { withHumanPass, fetchRelay, humanPassFresh } from '../js/human-check.js';

const env = { TURNSTILE_SECRET: 'test-secret-value', TURNSTILE_SITE_KEY: '0x4AAAA-site' };
const realFetch = globalThis.fetch;
const realNow = Date.now;

function req(path, init = {}) {
  return new Request(`https://relay.test${path}`, init);
}
async function call(path, init, e = env) {
  return worker.fetch(req(path, init), e);
}
function mockSiteverify(success) {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
      const form = init.body;
      assert.equal(form.get('secret'), 'test-secret-value');
      assert.ok(form.get('response'));
      return new Response(JSON.stringify(success ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 });
    }
    throw new Error(`unexpected network call in test: ${url}`);
  };
}

test('未配置防人机时：config 为 required=false，受保护接口不要求通行证（不返回 challenge）', async () => {
  const cfg = await (await call('/api/human/config', {}, {})).json();
  assert.equal(cfg.required, false);
  assert.equal(cfg.siteKey, '');
  // 参数缺失即返回 400，说明没有被防人机挡住
  const r = await call('/api/fetch', {}, {});
  assert.notEqual(r.status, 403);
});

test('配置后：config 暴露 siteKey（不暴露 secret），受保护接口无通行证返回 403 + challenge', async () => {
  const cfgRes = await call('/api/human/config', {});
  const text = await cfgRes.text();
  assert.doesNotMatch(text, /test-secret-value/);
  const cfg = JSON.parse(text);
  assert.equal(cfg.required, true);
  assert.equal(cfg.siteKey, env.TURNSTILE_SITE_KEY);
  for (const path of ['/api/search?q=x', '/api/crawl?url=https://a.test', '/api/file?url=https://a.test/x.pdf', '/api/fetch?url=https://a.test']) {
    const r = await call(path, {});
    assert.equal(r.status, 403, path);
    const body = await r.json();
    assert.equal(body.challenge, 'turnstile');
    assert.equal(body.siteKey, env.TURNSTILE_SITE_KEY);
  }
});

test('健康检查与版本页不受防人机影响', async () => {
  const r = await call('/api/health', {});
  assert.equal(r.status, 200);
});

test('verify：Turnstile 通过后签发 30 分钟通行证，凭它可通过受保护接口', async () => {
  mockSiteverify(true);
  try {
    const v = await call('/api/human/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'tok-abc' }) });
    assert.equal(v.status, 200);
    const j = await v.json();
    assert.match(j.pass, /^\d{9,12}\.[A-Za-z0-9_-]{20,}$/);
    assert.equal(j.ttl_s, 1800);
    assert.ok(j.exp > Math.floor(realNow() / 1000) + 1700);
    // 带通行证 → 不再是 403（参数缺失 400 即说明通过）
    const ok = await call('/api/fetch', { headers: { 'x-dubhe-human': j.pass } });
    assert.equal(ok.status, 400);
    // 篡改签名 → 仍 403
    const [exp, sig] = j.pass.split('.');
    const forged = `${exp}.${sig.slice(0, -2)}${sig.slice(-2) === 'AA' ? 'BB' : 'AA'}`;
    assert.equal((await call('/api/fetch', { headers: { 'x-dubhe-human': forged } })).status, 403);
    // 伪造过期时间（不知道密钥无法重签）→ 403
    assert.equal((await call('/api/fetch', { headers: { 'x-dubhe-human': `1000000000.${sig}` } })).status, 403);
  } finally { globalThis.fetch = realFetch; }
});

test('verify：通行证过期后被拒绝', async () => {
  mockSiteverify(true);
  try {
    const j = await (await call('/api/human/verify', { method: 'POST', body: JSON.stringify({ token: 't' }) })).json();
    Date.now = () => realNow() + 31 * 60 * 1000;
    assert.equal((await call('/api/fetch', { headers: { 'x-dubhe-human': j.pass } })).status, 403);
  } finally { Date.now = realNow; globalThis.fetch = realFetch; }
});

test('verify：Turnstile 未通过返回 403，不签发通行证；缺 token 返回 400', async () => {
  mockSiteverify(false);
  try {
    const r = await call('/api/human/verify', { method: 'POST', body: JSON.stringify({ token: 'bad' }) });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).pass, undefined);
    assert.equal((await call('/api/human/verify', { method: 'POST', body: '{}' })).status, 400);
  } finally { globalThis.fetch = realFetch; }
});

test('未配置时 verify 返回 404；非 GET/POST 仍 405', async () => {
  assert.equal((await call('/api/human/verify', { method: 'POST', body: '{}' }, {})).status, 404);
  assert.equal((await call('/api/health', { method: 'PUT' })).status, 405);
});

test('客户端：无通行证时 withHumanPass 原样返回；有通行证时注入 x-dubhe-human 头', () => {
  const base = { headers: { Accept: 'application/json' } };
  assert.equal(withHumanPass(base, ''), base);
  const out = withHumanPass({ headers: { Accept: 'x' } }, 'p.1');
  assert.equal(out.headers['x-dubhe-human'], 'p.1');
  assert.equal(out.headers.Accept, 'x');
  assert.equal(humanPassFresh(), '');
});

test('客户端：非挑战的响应原样透传（不弹窗、不重试）', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"ok":true}', { status: 200 }); };
  try {
    const r = await fetchRelay('/api/health', {});
    assert.equal(r.status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; }
});

test('客户端：403 但不是 turnstile 挑战时原样返回，不弹窗', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{"error":"forbidden"}', { status: 403 }); };
  try {
    const r = await fetchRelay('https://relay.test/api/search?q=x', {});
    assert.equal(r.status, 403);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = realFetch; }
});
