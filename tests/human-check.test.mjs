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

test('curl Worker is opt-in, requires Turnstile, bounds requests, and never follows redirects or leaks credentials', async () => {
  const e = { ...env, CURL_ENABLED: 'true' };
  let network = [];
  globalThis.fetch = async (url, init) => {
    network.push({ url: String(url), init });
    if (String(url).startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) return new Response('{"success":true}');
    if (String(url).includes('/redirect')) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    if (String(url).includes('/large')) return new Response('x'.repeat(300000), { headers: { 'content-type': 'text/plain' } });
    return new Response('{"problem":"bad request"}', { status: 400, headers: { 'content-type': 'application/json', 'set-cookie': 'secret=x' } });
  };
  try {
    const payload = { url: 'https://example.com/path', method: 'POST', headers: { 'content-type': 'application/json', 'x-test': 'hi' }, body: '{"hello":1}' };
    const post = (data, pass, environment = e) => call('/api/curl', { method: 'POST', headers: { 'content-type': 'application/json', ...(pass ? { 'x-dubhe-human': pass } : {}) }, body: JSON.stringify(data) }, environment);
    assert.equal((await post(payload, '', {})).status, 503);
    assert.equal((await post(payload, '', { CURL_ENABLED: 'true' })).status, 503);
    assert.equal((await post(payload, '')).status, 403);
    assert.equal(network.length, 0, 'challenge occurs before an upstream request');
    const health = await (await call('/api/health', {}, e)).json();
    assert.ok(health.capabilities.includes('curl'));
    const flagOnly = await (await call('/api/health', {}, { CURL_ENABLED: 'TRUE' })).json();
    assert.ok(flagOnly.capabilities.includes('curl'), 'health advertises the flag even without Turnstile; execution remains gated');
    const plainHealth = await (await call('/api/health', {}, env)).json();
    assert.ok(!plainHealth.capabilities.includes('curl'));
    const pass = (await (await call('/api/human/verify', { method: 'POST', body: JSON.stringify({ token: 'ok' }) }, e)).json()).pass;
    const response = await post(payload, pass);
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.status, 400, 'upstream errors remain observable');
    assert.match(result.body, /bad request/);
    assert.ok(!('set-cookie' in result.headers));
    const outgoing = network.at(-1);
    assert.equal(outgoing.init.method, 'POST'); assert.equal(outgoing.init.redirect, 'manual');
    assert.equal(outgoing.init.body, payload.body);
    const before = network.length;
    assert.equal((await post({ ...payload, headers: { Authorization: 'secret' } }, pass)).status, 400);
    assert.equal((await post({ ...payload, url: 'http://127.0.0.1/' }, pass)).status, 502);
    assert.equal((await post({ ...payload, body: 'x'.repeat(140000) }, pass)).status, 413);
    assert.equal(network.length, before);
    const redir = await (await post({ url: 'https://example.com/redirect' }, pass)).json();
    assert.equal(redir.status, 302); assert.equal(redir.redirect_followed, false); assert.equal(network.length, before + 1);
    const large = await (await post({ url: 'https://example.com/large' }, pass)).json();
    assert.equal(large.truncated, true); assert.equal(large.body.length, 256 * 1024);
  } finally { globalThis.fetch = realFetch; }
});

test('curl capability is gated by worker health, the web switch, and offline policy', async () => {
  const { deriveToolWhitelistFromBits, selectToolsForTurn } = await import('../js/executionContext.js');
  const { TOOL_DEFS } = await import('../js/tools.js');
  const { computeCapabilityVector } = await import('../js/nexus.js');
  const { getToolContract } = await import('../js/execution.js');
  const has = wl => wl.allowed.some(t => t.name === 'curl');
  assert.equal(has(deriveToolWhitelistFromBits({ relay: true, web: true }, TOOL_DEFS)), false);
  assert.equal(has(deriveToolWhitelistFromBits({ relay: true, web: false, curl: true }, TOOL_DEFS)), false);
  const allowed = deriveToolWhitelistFromBits({ relay: true, web: true, curl: true }, TOOL_DEFS);
  assert.equal(has(allowed), true);
  assert.ok(selectToolsForTurn({ allowed: allowed.allowed, text: '用 curl 发送 HTTP 请求' }).mounted.some(t => t.name === 'curl'));
  assert.ok(computeCapabilityVector({ relayOk: true, webEnabled: true, curlEnabled: true }).enabledTools.includes('curl'));
  assert.ok(!computeCapabilityVector({ relayOk: true, webEnabled: true }).enabledTools.includes('curl'));
  assert.equal(getToolContract('curl').idempotent, false);
  assert.equal(getToolContract('curl').retryPolicy, 'never');
});

test('curl agent flow requires a fresh human decision for each request even with session approval', async () => {
  const { resetRelayProbe } = await import('../js/net.js');
  const { createStore } = await import('../js/state.js');
  const { createAgent } = await import('../js/agent.js');
  const responses = [];
  const ev = data => 'data: ' + JSON.stringify(data) + '\n\n';
  const turn = (id, method) => new Response(ev({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name: 'curl', arguments: JSON.stringify({ url: `https://example.com/${id}`, method }) } }] } }] }) + ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  responses.push(turn('first', 'GET'), turn('second', 'POST'), new Response(ev({ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const outgoing = []; const chatTables = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/api/health')) {
      if (!u.startsWith('https://relay.dubhe-agent.workers.dev/')) return new Response('', { status: 404 });
      return new Response(JSON.stringify({ ok: true, relay: 'dubhe-cf-worker', version: '1.8.0', capabilities: ['fetch', 'search', 'crawl', 'file', 'curl'] }), { headers: { 'content-type': 'application/json' } });
    }
    if (u.endsWith('/api/curl')) { outgoing.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: 200, headers: {}, body: 'ok', truncated: false, binary: false })); }
    if (u.includes('/chat/completions')) { chatTables.push(JSON.parse(init.body).tools || []); return responses.shift(); }
    throw new Error(`unexpected ${u}`);
  };
  resetRelayProbe();
  try {
    const store = createStore();
    store.state.apiKey = 'test'; store.state.model = 'gpt-5.6-sol'; store.state.relayOk = null;
    Object.assign(store.state.settings, { webEnabled: true, jevEnabled: false, autoReview: false, executionGuard: 'observe', toolApprovals: { curl: 'allow-session' } });
    let confirmations = 0; let decision = 'allow-session';
    const agent = createAgent(store, { onConfirmationRequest: (call, text, key) => {
      assert.equal(call.name, 'curl'); assert.match(text, /完整请求参数/); assert.match(text, /example\.com/);
      confirmations++; setTimeout(() => agent.resolveConfirmation(key, decision), 0);
    } });
    await agent.send('用 curl 执行 HTTP 请求');
    assert.ok(chatTables[0].some(t => t.function?.name === 'curl'), 'live Worker health payload mounts curl in the actual Agent request');
    assert.equal(confirmations, 2, JSON.stringify(store.state.messages));
    assert.deepEqual(outgoing.map(r => r.method), ['GET', 'POST']);
    decision = 'deny';
    responses.push(turn('third', 'DELETE'), new Response(ev({ choices: [{ delta: { content: 'Denied' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
    await agent.send('用 curl 发 DELETE 请求');
    assert.equal(confirmations, 3);
    assert.equal(outgoing.length, 2, 'a denied call never reaches the Worker');
  } finally { globalThis.fetch = realFetch; resetRelayProbe(); }
});

test('a reset invalidates older in-flight relay probes and prevents stale state from winning', async () => {
  const { resetRelayProbe, relayAvailable, currentRelay, relaySupports } = await import('../js/net.js');
  let release;
  const oldReply = new Promise(resolve => { release = resolve; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return oldReply;
    return new Response(JSON.stringify({ ok: true, capabilities: ['fetch', 'search', 'crawl', 'file', 'curl'] }), { headers: { 'content-type': 'application/json' } });
  };
  const health = capabilities => new Response(JSON.stringify({ ok: true, capabilities }), { headers: { 'content-type': 'application/json' } });
  try {
    resetRelayProbe();
    const stale = relayAvailable();
    resetRelayProbe();
    assert.equal(await relayAvailable(), true);
    assert.equal(relaySupports('curl'), true);
    release(health(['fetch']));
    assert.equal(await stale, false);
    assert.equal(relaySupports('curl'), true);
    assert.equal(currentRelay().label, 'origin');
  } finally { globalThis.fetch = realFetch; resetRelayProbe(); }
});

test('autonomous scheduler preserves order of potentially stateful HTTP requests', async () => {
  const { planToolWaves } = await import('../js/toolrunner.js');
  const calls = [
    { name: 'curl', args: { url: 'https://example.test/a', method: 'POST' } },
    { name: 'curl', args: { url: 'https://example.test/b', method: 'GET' } },
    { name: 'write_file', args: { path: 'out.txt', content: 'x' } },
  ];
  const waves = planToolWaves(calls);
  assert.ok(waves.findIndex(w => w.indices.includes(0)) < waves.findIndex(w => w.indices.includes(1)));
  assert.ok(waves.some(w => w.indices.includes(2)), 'independent local work remains schedulable');
});

test('specialist loop rejects hallucinated tools before execution, including confirmation-gated curl', async () => {
  const { runSubagent } = await import('../js/agent.js');
  const { createFS } = await import('../js/sandbox.js');
  const original = globalThis.fetch, requests = [];
  const frame = obj => `data: ${JSON.stringify(obj)}\n\n`;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /chat\/completions/, 'no direct network or curl execution');
    requests.push(JSON.parse(init.body));
    const content = requests.length === 1
      ? frame({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'bad-1', function: { name: 'write_file', arguments: '{"path":"stolen.txt","content":"x"}' } },
        { index: 1, id: 'bad-2', function: { name: 'curl', arguments: '{"url":"https://example.test/"}' } },
      ] } }] }) + frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      : frame({ choices: [{ delta: { content: 'Blocked' }, finish_reason: 'stop' }] });
    return new Response(content + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const fs = createFS();
    await runSubagent({ id: 'test', name: 'Test', tag: 'Test', tools: [], prompt: 'Test' }, 'Test', { apiKey: 'test', model: 'gpt-5.6-sol', fs, sandboxEnabled: true, signal: new AbortController().signal });
    assert.equal(requests.length, 2);
    assert.equal(fs.list().some(f => f.path === 'stolen.txt'), false);
    const messages = requests[1].messages.filter(m => m.role === 'tool');
    assert.equal(messages.length, 2);
    assert.ok(messages.every(m => /specialist-tool-not-authorized/.test(m.content)));
  } finally { globalThis.fetch = original; }
});

test('specialist cannot bypass risk confirmation for an allowed tool or be given curl directly', async () => {
  const { runSubagent, subagentTools } = await import('../js/agent.js');
  const { createFS } = await import('../js/sandbox.js');
  const def = { id: 'test', name: 'Test', tag: 'Test', tools: ['write_file', 'curl'], prompt: 'Test' };
  assert.ok(!subagentTools(true, def).some(t => t.name === 'curl'));
  const original = globalThis.fetch, requests = [];
  const frame = obj => `data: ${JSON.stringify(obj)}\n\n`;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const response = requests.length === 1
      ? frame({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'c1', function: { name: 'write_file', arguments: '{"path":"uploads/original.txt","content":"changed"}' } },
        { index: 1, id: 'c2', function: { name: 'write_file', arguments: '{"path":"outputs/new.txt","content":"new"}' } },
      ] } }] }) + frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      : frame({ choices: [{ delta: { content: 'Done' }, finish_reason: 'stop' }] });
    return new Response(response + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const fs = createFS({ 'uploads/original.txt': 'original' });
    await runSubagent(def, 'work', { apiKey: 'test', model: 'gpt-5.6-sol', fs, sandboxEnabled: true, signal: new AbortController().signal });
    assert.equal(fs.read('uploads/original.txt'), 'original');
    assert.equal(fs.read('outputs/new.txt'), 'new');
    assert.match(requests[1].messages.find(m => m.role === 'tool' && m.tool_call_id === 'c1').content, /CONFIRMATION_REQUIRED/);
  } finally { globalThis.fetch = original; }
});

test('Turnstile 110200 explains the application hostname, not only the relay host', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<body></body>', { url: 'https://app.example.test/' });
  const previous = { document: globalThis.document, location: globalThis.location, turnstile: globalThis.turnstile };
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: dom.window.location, writable: true, configurable: true });
  let widget;
  globalThis.turnstile = { render: (box, opts) => { widget = opts; return 'widget'; }, remove() {} };
  try {
    const { solveHumanChallenge } = await import('../js/human-check.js?hostname-test');
    const pending = solveHumanChallenge({ origin: 'https://relay.example.test', siteKey: 'site' });
    await Promise.resolve();
    assert.equal(widget['error-callback']('110200'), true);
    const message = document.querySelector('.human-check-status').textContent;
    assert.match(message, /app\.example\.test/);
    assert.match(message, /Hostname Management/);
    document.querySelector('.human-check-cancel').click();
    assert.equal(await pending, '');
  } finally {
    for (const [key, value] of Object.entries(previous)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    dom.window.close();
  }
});
