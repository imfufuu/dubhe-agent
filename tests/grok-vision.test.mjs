import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { GROK_SENSITIVE_VISION_MODEL } from '../js/config.js';
import { setGatewayBase, GATEWAY_CN, GATEWAY_GLOBAL } from '../js/endpoint.js';
import { executeTool } from '../js/tools.js';
import { createFS } from '../js/sandbox.js';
import { analyzeImage } from '../js/vision.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZYAAAAASUVORK5CYII=';
const data = `data:image/png;base64,${png}`;
const reply = (finish = 'stop', content = '看见一张图片') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 23, completion_tokens: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } });

test('risk acknowledgement and gateway filter control visibility without silently changing selection', async () => {
  const dom = new JSDOM(readFileSync(new URL('../app.html', import.meta.url), 'utf8'), { url: 'https://dubhe.test/app.html', pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'navigator']) if (window[key] !== undefined) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  const { mountSettings, openSettingsModal } = await import('../js/settings.js');
  const subscribers = [];
  const store = { state: { gatewayId: 'teamorouter', apiKey: '', gatewayKeys: {}, gatewayBaseUrls: {}, modelsByGateway: {}, modelsFetchedAtByGateway: {}, manualModelsByGateway: {}, models: [], model: '__smart_router__', sessions: [], settings: { theme: 'light', contentModeration: true } }, notify() { for (const cb of subscribers) cb(); }, subscribe(cb) { subscribers.push(cb); return () => {}; } };
  setGatewayBase(GATEWAY_GLOBAL);
  mountSettings(store);
  openSettingsModal({ store });
  const $ = s => window.document.querySelector(s);
  const exists = () => [...$('#set-vision-model').options].some(o => o.value === GROK_SENSITIVE_VISION_MODEL);
  assert.equal(exists(), false);
  $('#set-moderation').checked = false; $('#set-moderation').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(exists(), false, 'pending confirmation cannot expose the option');
  $('#moderation-risk-ack').checked = true; $('#moderation-risk-ack').dispatchEvent(new window.Event('change', { bubbles: true }));
  $('#moderation-risk-confirm').click();
  assert.equal(exists(), true);
  $('#set-vision-model').value = GROK_SENSITIVE_VISION_MODEL; $('#set-vision-model').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(store.state.settings.visionModel, GROK_SENSITIVE_VISION_MODEL);
  setGatewayBase(GATEWAY_CN);
  assert.equal(exists(), false, 'the .cn menu never shows Grok');
  assert.equal($('#set-vision-model').value, '', 'unavailable selection is visible as a prompt to reselect, not silently changed');
  assert.equal(store.state.settings.visionModel, GROK_SENSITIVE_VISION_MODEL);
  setGatewayBase(GATEWAY_GLOBAL);
  assert.equal(exists(), true);
  $('#set-gateway').value = 'cloudflare'; $('#set-gateway').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(exists(), false, 'Workers AI cannot use xAI models');
  assert.match($('#set-gateway-connection-note').textContent, /^(?:填写自己的 Worker HTTPS 地址|Enter your Worker HTTPS URL)$/);
  $('#set-gateway').value = 'grok'; $('#set-gateway').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(exists(), true, 'the direct xAI gateway exposes the explicit choice');
  $('#set-moderation').checked = true; $('#set-moderation').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(exists(), false);
  assert.equal($('#set-vision-model').value, '');
  await new Promise(resolve => setTimeout(resolve, 150));
  dom.window.close();
});

test('selected sensitive model requires live consent and a compatible gateway before every paid POST', async () => {
  const fs = createFS({ 'uploads/a.png': data });
  const previous = globalThis.fetch; let calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts, body: JSON.parse(opts.body) }); return reply(); };
  try {
    setGatewayBase(GATEWAY_GLOBAL);
    const ctx = { fs, apiKey: 'test-key', gatewayId: 'teamorouter', visionModel: GROK_SENSITIVE_VISION_MODEL };
    const args = { path: 'uploads/a.png', prompt: '请描述图片' };
    assert.match(await executeTool('analyze_image', args, { ...ctx, canUseSensitiveVision: () => false }), /请求未发送/);
    assert.equal(calls.length, 0);
    assert.match(await executeTool('analyze_image', args, { ...ctx, gatewayId: 'openai', canUseSensitiveVision: () => true }), /请求未发送/);
    assert.equal(calls.length, 0);
    setGatewayBase(GATEWAY_CN);
    assert.match(await executeTool('analyze_image', args, { ...ctx, canUseSensitiveVision: () => true }), /请求未发送/);
    assert.equal(calls.length, 0);
    setGatewayBase(GATEWAY_GLOBAL);
    assert.match(await executeTool('analyze_image', args, { ...ctx, canUseSensitiveVision: () => true }), /识图完成/);
    assert.equal(calls.length, 1); assert.match(calls[0].url, /api\.teamorouter\.com\/v1\/chat\/completions/);
    assert.equal(calls[0].body.model, GROK_SENSITIVE_VISION_MODEL);
    assert.deepEqual(calls[0].body.messages[0].content, [{ type: 'text', text: args.prompt }, { type: 'image_url', image_url: { url: data } }]);
    assert.equal(calls[0].opts.redirect, 'error');
    calls = [];
    globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return reply('length', '第一段'); };
    let checks = 0;
    assert.match(await executeTool('analyze_image', args, { ...ctx, canUseSensitiveVision: () => ++checks < 3 }), /请求未发送/);
    assert.equal(calls.length, 1, 'if consent changes, no continuation is sent');
  } finally { globalThis.fetch = previous; setGatewayBase(GATEWAY_GLOBAL); }
});

test('xAI direct request matches official chat-completions vision schema and preserves provider refusal', async () => {
  const old = globalThis.fetch; let request;
  globalThis.fetch = async (url, opts) => { request = { url: String(url), opts, body: JSON.parse(opts.body) }; return reply(); };
  try {
    const output = await analyzeImage({ apiKey: 'xai-test', gatewayId: 'grok', model: GROK_SENSITIVE_VISION_MODEL, dataUrl: data, prompt: 'Describe this.' });
    assert.equal(output, '看见一张图片');
    assert.equal(request.url, 'https://api.x.ai/v1/chat/completions');
    assert.equal(request.opts.headers.Authorization, 'Bearer xai-test');
    assert.deepEqual(request.body.messages[0].content[1], { type: 'image_url', image_url: { url: data } });
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: null, refusal: 'Not allowed' } }] }), { status: 200 });
    await assert.rejects(analyzeImage({ apiKey: 'xai-test', gatewayId: 'grok', model: GROK_SENSITIVE_VISION_MODEL, dataUrl: data }), /服务商拒绝处理/);
  } finally { globalThis.fetch = old; }
});
test('actual tool-runner context checks acknowledgement live, not just at turn start', async () => {
  const { createToolRunner } = await import('../js/toolrunner.js');
  const { MODERATION_ACK_VERSION } = await import('../js/ui-moderation-setting.js');
  const fs = createFS({ 'uploads/a.png': data });
  const store = { state: { gatewayId: 'grok', settings: { contentModeration: false, moderationRiskAccepted: MODERATION_ACK_VERSION, visionModel: GROK_SENSITIVE_VISION_MODEL }, sessions: [] } };
  const runner = createToolRunner({ store, emit() {}, getFs: () => fs, runSubagent() {} });
  const turn = { apiKey: 'xai-test', gatewayId: 'grok', visionModel: GROK_SENSITIVE_VISION_MODEL };
  const ctx = runner.toolCtxFor({ id: 'a', name: 'analyze_image', args: {} }, turn);
  assert.equal(ctx.canUseSensitiveVision(), true);
  store.state.gatewayId = 'cloudflare'; assert.equal(ctx.canUseSensitiveVision(), false);
  store.state.gatewayId = 'grok';
  store.state.settings.contentModeration = true;
  assert.equal(ctx.canUseSensitiveVision(), false);
  store.state.settings.contentModeration = false; store.state.settings.moderationRiskAccepted = '';
  assert.equal(ctx.canUseSensitiveVision(), false);
  store.state.settings.moderationRiskAccepted = MODERATION_ACK_VERSION; store.state.settings.visionModel = 'deepseek-v4-flash-vision-exp';
  assert.equal(ctx.canUseSensitiveVision(), false);
});

test('Grok vision never replays a lost response or falls back to another gateway', async () => {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push(String(url)); throw new TypeError('lost'); };
  try {
    setGatewayBase(GATEWAY_GLOBAL);
    await assert.rejects(analyzeImage({ apiKey: 'test', gatewayId: 'teamorouter', model: GROK_SENSITIVE_VISION_MODEL, dataUrl: data }), /lost/);
    assert.equal(calls.length, 1); assert.match(calls[0], /api\.teamorouter\.com/);
  } finally { globalThis.fetch = old; }
});
test('non-PNG/JPEG inputs are converted locally for Grok, or fail closed if conversion fails', async () => {
  const oldImage = globalThis.Image, oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  let sent;
  globalThis.Image = class { constructor() { this.width = 12; this.height = 12; } set src(_) { queueMicrotask(() => this.onload()); } };
  globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => data }) };
  globalThis.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return reply(); };
  try {
    assert.equal(await analyzeImage({ apiKey: 'xai-test', gatewayId: 'grok', model: GROK_SENSITIVE_VISION_MODEL, dataUrl: 'data:image/webp;base64,UklGRg==' }), '看见一张图片');
    assert.equal(sent.messages[0].content[1].image_url.url, data);
    globalThis.Image = class { set src(_) { queueMicrotask(() => this.onerror()); } };
    let count = 0; globalThis.fetch = async () => { count++; return reply(); };
    await assert.rejects(analyzeImage({ apiKey: 'xai-test', gatewayId: 'grok', model: GROK_SENSITIVE_VISION_MODEL, dataUrl: 'data:image/gif;base64,R0lGODlh' }), /无法转换/);
    assert.equal(count, 0);
  } finally { globalThis.Image = oldImage; globalThis.document = oldDocument; globalThis.fetch = oldFetch; }
});
