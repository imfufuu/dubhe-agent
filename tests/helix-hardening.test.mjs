import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createEffectJournal, requiresEffectJournal, EFFECT_JOURNAL_KEY } from '../js/effect-journal.js';
import { operationKey, planReplay } from '../js/idempotency.js';
import { buildCheckpoint, createCheckpointStore } from '../js/recovery.js';
import { classifyToolRisk, classifyToolFailure, getToolContract, buildCapabilityConstraints, checkCapabilityConstraints, summarizeArgs, createConfirmationGate } from '../js/execution.js';
import { toolAccessSet, planToolWaves, runWithCategoryLimits } from '../js/toolrunner.js';
import { generateImage, createVideoJob, streamChat } from '../js/api.js';
import { createAgent } from '../js/agent.js';
import { createStore } from '../js/state.js';

function memoryStorage() {
  const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,String(v)), removeItem: k => data.delete(k) };
}
test('durable effect journal survives reconstruction, bounds only completed entries, and fails closed', () => {
  const storage = memoryStorage(), journal = createEffectJournal({ storage });
  journal.begin({ key: 'one', tool: 'generate_image', turnId: 't1', sessionId: 'original', fingerprint: 'hash', prompt: 'secret' });
  assert.equal(createEffectJournal({ storage }).lookup('one').status, 'uncertain');
  assert.equal(createEffectJournal({ storage }).lookup('new-session', { fingerprint: 'hash' }).status, 'uncertain');
  assert.doesNotMatch(storage.getItem(EFFECT_JOURNAL_KEY), /secret|prompt/);
  journal.settle('one', 'succeeded'); assert.equal(journal.lookup('one').status, 'succeeded');
  assert.equal(journal.lookup('new-session', { fingerprint: 'hash', knownSessions: ['original'] }), null);
  assert.equal(journal.lookup('new-session', { fingerprint: 'hash', knownSessions: [] }).status, 'succeeded');
  for (let i = 0; i < 95; i++) journal.begin({ key: `p${i}`, tool: 'curl', turnId: 't' });
  journal.begin({ key: 'pending', tool: 'curl', turnId: 't' });
  assert.equal(journal.lookup('one'), null); assert.equal(journal.lookup('p0').status, 'uncertain');
  assert.throws(() => journal.begin({ key: 'extra', tool: 'curl', turnId: 't' }), /未核验/);
  storage.setItem(EFFECT_JOURNAL_KEY, 'invalid'); assert.throws(() => journal.lookup('x'), /损坏/);
  const denied = createEffectJournal({ storage: { getItem: () => null, setItem() { throw Error('quota'); } } });
  assert.throws(() => denied.begin({ key: 'x', tool: 'curl', turnId: 't' }), /quota/);
  const competing = createEffectJournal({ storage: memoryStorage() });
  competing.begin({ key: 'other', tool: 'curl', turnId: 't1', fingerprint: 'same' });
  competing.begin({ key: 'this', tool: 'curl', turnId: 't2', fingerprint: 'same' });
  competing.settle('this', 'failed');
  assert.equal(competing.lookup('this', { fingerprint: 'same' }).key, 'other');
  const base = memoryStorage(); let writes = 0;
  const failingSettle = createEffectJournal({ storage: { getItem: k => base.getItem(k), setItem(k, v) { if (++writes > 1) throw Error('quota'); base.setItem(k, v); } } });
  failingSettle.begin({ key: 'x', tool: 'curl', turnId: 't' });
  assert.throws(() => failingSettle.settle('x', 'succeeded'), /quota/);
  assert.equal(failingSettle.lookup('x').status, 'uncertain');
});
test('effect policy does not mistake an invalid image comparison for a free local operation', () => {
  const c = getToolContract('generate_image');
  assert.equal(requiresEffectJournal('generate_image', { compare_paths: ['a'] }, c), true);
  assert.equal(requiresEffectJournal('generate_image', { compare_paths: ['a', 'b'] }, c), false);
  assert.equal(requiresEffectJournal('generate_image', { compare_paths: ['a', '../b'] }, c), true);
  assert.equal(requiresEffectJournal('local_desktop', { action: 'scroll' }, getToolContract('local_desktop')), true);
  assert.equal(requiresEffectJournal('run_git', { scope: 'project' }, getToolContract('run_git')), false);
});
test('unknown effects require explicit verified-not-applied retry followed by confirmation', () => {
  const args = { prompt: 'private' }, k = operationKey({ toolName: 'generate_image', args, sessionId: 'a' });
  assert.notEqual(k, operationKey({ toolName: 'generate_image', args, sessionId: 'b' }));
  const entry = { status: 'uncertain', turnId: 'before' }, contract = getToolContract('generate_image');
  for (const userText of ['重新解释', '再生成一次', '确认重新生成', '核验后继续']) assert.equal(planReplay({ entry, contract, userText, currentTurnId: 'after' }).decision, 'verify-first');
  assert.equal(planReplay({ entry, contract, userText: '已核验未执行，请重新生成', currentTurnId: 'after' }).requireReconfirmation, true);
  assert.equal(planReplay({ entry, contract, userText: '已核验未执行，请重新生成', currentTurnId: 'before' }).decision, 'verify-first');
  for (const msg of ['HTTP 503', '网关未返回任务 ID', '下载失败', 'AbortError']) assert.equal(classifyToolFailure({ name: 'generate_image', result: msg }).kind, 'SIDE_EFFECT_UNCERTAIN');
  assert.notEqual(classifyToolFailure({ name: 'generate_image', result: '图像调用在发起前失败：找不到参考图' }).kind, 'SIDE_EFFECT_UNCERTAIN');
});
test('normalized paths conflict and protected paths cannot be bypassed by aliases', () => {
  const calls = [{ name: 'write_file', args: { path: 'foo//bar', content: 'x' } }, { name: 'read_file', args: { path: './foo/bar' } }];
  assert.deepEqual(planToolWaves(calls).map(w => w.indices), [[0], [1]]);
  assert.deepEqual(toolAccessSet({ name: 'write_file', args: { path: 'project/a', source_path: 'foo//bar' } }).reads, ['foo/bar']);
  assert.deepEqual(toolAccessSet({ name: 'analyze_image', args: { path: 'https://example.test/x' } }).writes, ['*']);
  assert.equal(classifyToolRisk({ name: 'write_file', args: { path: './uploads//x' }, fs: { 'uploads/x': 'v' }, userText: '运行测试' }).requiresConfirmation, true);
  const caps = buildCapabilityConstraints({ sandboxEnabled: true, overrides: { sandbox: { allowedPaths: ['files/'] } } });
  assert.equal(checkCapabilityConstraints({ name: 'copy_file', args: { from: 'files/ok', to: 'files_evil/x' }, capabilities: caps }).decision, 'deny');
});
test('audit and checkpoints avoid persisting content previews', () => {
  const summary = summarizeArgs('curl', { url: 'https://user:pass@site.test/x?token=secret', body: 'private-body', headers: { Authorization: 'secret' } });
  assert.doesNotMatch(summary, /pass|secret|private-body/); assert.match(summary, /site.test/);
  const cp = buildCheckpoint({ turnId: 'a', sessionId: 's', artifacts: [{ path: 'a' }], fs: { a: 'private-file' } });
  assert.doesNotMatch(JSON.stringify(cp), /private-file|preview/);
  const old = createCheckpointStore({ entries: [{ checkpointId: 'old', artifacts: [{ path: 'a', preview: 'private-file' }] }] });
  assert.doesNotMatch(JSON.stringify(old.toJSON()), /private-file|preview/);
});
test('batch waits for all effects to finish before propagating rejection', async () => {
  let finished = false;
  await assert.rejects(runWithCategoryLimits([{ index: 0, name: 'read_file' }, { index: 1, name: 'read_file' }], async i => {
    if (!i) throw Error('aborted');
    await new Promise(r => setTimeout(r, 30)); finished = true;
  }), /aborted/);
  assert.equal(finished, true);
});

test('billable image, video creation and specialist requests never fail over on network error', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(generateImage({ model: 'gpt-image-2', apiKey: 'test', prompt: 'x' })); assert.equal(calls, 1);
    await assert.rejects(createVideoJob({ apiKey: 'test', body: { prompt: 'x' } })); assert.equal(calls, 2);
    await assert.rejects(streamChat({ model: 'gpt-5.6-sol', apiKey: 'test', messages: [], subagentId: 'explainer' })); assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});
const ev = obj => `data: ${JSON.stringify(obj)}\n\n`;
const response = text => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
const tool = (name, args) => response(ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name, arguments: JSON.stringify(args) } }] } }] }) + ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n');
const final = () => response(ev({ choices: [{ delta: { content: '已处理' } }] }) + ev({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
function setup() {
  const dom = new JSDOM('', { url: 'https://example.test' }), oldStorage = globalThis.localStorage, oldFetch = globalThis.fetch;
  globalThis.localStorage = dom.window.localStorage;
  const store = createStore(); store.state.apiKey = 'sk-test'; store.state.model = 'gpt-5.6-sol';
  Object.assign(store.state.settings, { webEnabled: false, jevEnabled: false, autoReview: false, executionGuard: 'observe' });
  return { store, cleanup() { globalThis.localStorage = oldStorage; globalThis.fetch = oldFetch; dom.window.close(); } };
}
test('real agent blocks deletion when authorization is revoked or target changes while confirmation is open', async () => {
  for (const change of ['revoke', 'file']) {
    const { store, cleanup } = setup(); let i = 0; let agent;
    globalThis.fetch = async () => ++i === 1 ? tool('delete_file', { path: './files//x.txt' }) : final();
    try {
      store.state.files = { 'files/x.txt': 'original' };
      agent = createAgent(store, { onConfirmationRequest: (_call, _request, key) => {
        if (change === 'revoke') store.state.settings.toolApprovals = { delete_file: 'deny' };
        else agent.sandboxWrite('files/x.txt', 'new content');
        setTimeout(() => agent.resolveConfirmation(key, 'allow-once'), 0);
      } });
      agent.loadFiles(store.state.files); await agent.send('运行测试然后删除文件');
      assert.equal(store.state.files['files/x.txt'], change === 'file' ? 'new content' : 'original');
      assert.match(store.state.messages.find(m => m.role === 'tool').content, /未执行/);
    } finally { cleanup(); }
  }
});
test('real agent records image before POST and blocks uncertain replay after re-instantiation', async () => {
  const { store, cleanup } = setup(); let modelCalls = 0, imageCalls = 0; const args = { prompt: 'a blue sky' };
  globalThis.fetch = async url => {
    if (String(url).includes('/images/generations')) {
      imageCalls++;
      const log = JSON.parse(globalThis.localStorage.getItem(EFFECT_JOURNAL_KEY));
      assert.equal(log.at(-1).status, 'in-flight');
      return new Response('upstream error', { status: 503 });
    }
    modelCalls++; return modelCalls % 2 ? tool('generate_image', args) : final();
  };
  try {
    store.state.imageModel = 'gpt-image-2';
    let agent = createAgent(store, {}); await agent.send('生成一张蓝天图片');
    assert.equal(imageCalls, 1);
    assert.equal(JSON.parse(globalThis.localStorage.getItem(EFFECT_JOURNAL_KEY)).at(-1).status, 'uncertain');
    store.save(true);
    const reloaded = createStore(); reloaded.state.apiKey = 'sk-test';
    agent = createAgent(reloaded, {}); await agent.send('请继续处理图片');
    assert.equal(imageCalls, 1);
    assert.match(reloaded.state.messages.filter(m => m.role === 'tool').at(-1).content, /核验|不确定/);
    let confirmed = 0;
    agent = createAgent(reloaded, { onConfirmationRequest: (call, request, key) => {
      assert.equal(call._confirmOnceOnly, true); assert.match(request, /核验/); confirmed++;
      setTimeout(() => agent.resolveConfirmation(key, 'allow-once'), 0);
    } });
    await agent.send('已核验未执行，请重新生成图片');
    assert.equal(confirmed, 1); assert.equal(imageCalls, 2);
  } finally { cleanup(); }
});

test('real agent never sends a billable request when the journal cannot be written', async () => {
  const { store, cleanup } = setup(); let imageCalls = 0, modelCalls = 0;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => originalStorage.getItem(k), setItem(k,v) { if (k === EFFECT_JOURNAL_KEY) throw Error('quota'); originalStorage.setItem(k,v); }, removeItem: k => originalStorage.removeItem(k) };
  globalThis.fetch = async url => {
    if (String(url).includes('/images/generations')) { imageCalls++; return new Response('{}'); }
    return ++modelCalls === 1 ? tool('generate_image', { prompt: 'test' }) : final();
  };
  try {
    store.state.imageModel = 'gpt-image-2';
    await createAgent(store, {}).send('生成一张图片');
    assert.equal(imageCalls, 0);
    assert.match(store.state.messages.filter(m => m.role === 'tool').at(-1).content, /无法写入防重复日志/);
  } finally { cleanup(); }
});

test('once-only confirmation cannot poison the session allowlist', async () => {
  const gate = createConfirmationGate({ timeoutMs: 1000 });
  const wait = gate.wait({ key: 'x', tool: 'delete_file', onceOnly: true });
  gate.resolve('x', 'allow-session');
  assert.equal((await wait).decision, 'deny');
  assert.equal(gate.isSessionAllowed('delete_file'), false);
});

test('failed concurrent duplicate specialist calls cannot be reported as successful', async () => {
  const { store, cleanup } = setup(); let mainCalls = 0, subCalls = 0;
  Object.assign(store.state.settings, { thinking: true, reasoningLevel: 'ultra' });
  const both = () => response(ev({ choices: [{ delta: { tool_calls: [0,1].map(i => ({ index: i, id: `call${i}`, function: { name: 'dispatch_subagent', arguments: JSON.stringify({ agent: 'explainer', task: 'explain' }) } })) } }] }) + ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n');
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (String(body.messages?.[0]?.content || '').includes('体系中的')) { subCalls++; await new Promise(r => setTimeout(r, 20)); return new Response('upstream error', { status: 503 }); }
    return ++mainCalls === 1 ? both() : final();
  };
  try {
    await createAgent(store, {}).send('并发委派两个专家');
    assert.equal(subCalls, 1);
    const runs = store.state.lastExecutionRecord.toolRuns.filter(r => r.name === 'dispatch_subagent');
    assert.equal(runs.length, 2); assert.ok(runs.every(r => r.status === 'failed'), JSON.stringify(runs));
  } finally { cleanup(); }
});

test('stopping while a confirmation is open resolves it immediately and never executes', async () => {
  const { store, cleanup } = setup(); let i = 0; let agent;
  globalThis.fetch = async () => ++i === 1 ? tool('delete_file', { path: 'files/x.txt' }) : final();
  try {
    store.state.files = { 'files/x.txt': 'original' };
    agent = createAgent(store, { onConfirmationRequest: () => setTimeout(() => agent.abort(), 0) });
    agent.loadFiles(store.state.files);
    await Promise.race([agent.send('删除文件'), new Promise((_, reject) => setTimeout(() => reject(Error('confirmation did not cancel')), 1500))]);
    assert.equal(store.state.files['files/x.txt'], 'original');
    assert.deepEqual(agent.getConfirmationState().pending, []);
  } finally { cleanup(); }
});

test('an unresolved effect blocks another session if the original session was lost before saving', async () => {
  const { store, cleanup } = setup(); let chat = 0, images = 0;
  globalThis.fetch = async url => {
    if (String(url).includes('/images/generations')) { images++; return new Response('error', { status: 503 }); }
    return ++chat % 2 ? tool('generate_image', { prompt: 'same request' }) : final();
  };
  try {
    store.state.imageModel = 'gpt-image-2';
    await createAgent(store, {}).send('生成图片');
    assert.equal(images, 1);
    store.createSession(); store.state.model = 'gpt-5.6-sol'; store.state.imageModel = 'gpt-image-2';
    await createAgent(store, {}).send('生成图片');
    assert.equal(images, 1); assert.match(store.state.messages.filter(m => m.role === 'tool').at(-1).content, /核验|不确定/);
    let agent, confirmations = 0;
    agent = createAgent(store, { onConfirmationRequest: (_call, _text, key) => { confirmations++; setTimeout(() => agent.resolveConfirmation(key, 'allow-once'), 0); } });
    await agent.send('已核验未执行，请重新生成');
    assert.equal(confirmations, 1); assert.equal(images, 2);
    const records = JSON.parse(globalThis.localStorage.getItem(EFFECT_JOURNAL_KEY));
    assert.equal(records.filter(r => r.status === 'uncertain').length, 1);
    assert.equal(records.filter(r => r.status === 'failed').length, 1);
  } finally { cleanup(); }
});
