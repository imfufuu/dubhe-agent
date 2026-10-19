import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_GATEWAY_ID, GATEWAYS, defaultModelForGateway, filterGatewayChatModels,
  gatewayFallbackModels, gatewayModelListLabel, getGateway, isLikelyChatModel, isModelForGateway,
} from '../js/gateway-registry.js';
import { mergeAvailableModels } from '../js/model-catalog.js';
import { providerIcon } from '../js/icons.js';
import { SMART_ROUTER_PROVIDER_LABEL } from '../js/smartrouter.js';

const IDs = (gatewayId) => gatewayFallbackModels(gatewayId).map((model) => model.id);

test('first-party offline model fallbacks are provider-curated text/chat IDs, not TeamoRouter catalog leakage', () => {
  const official = GATEWAYS.filter((gateway) => gateway.category === 'first-party');
  for (const gateway of official) {
    const models = gatewayFallbackModels(gateway.id);
    assert.ok(models.length, `${gateway.id} has checked-in official model suggestions`);
    assert.equal(new Set(models.map((model) => model.id)).size, models.length, `${gateway.id} IDs are unique`);
    assert.ok(models.every((model) => model.provider === gateway.provider), `${gateway.id} metadata stays provider-specific`);
    assert.ok(models.every((model) => model.channel === 'chat' && isLikelyChatModel(model.id)), `${gateway.id} fallback contains chat-capable IDs only`);
  }
  assert.deepEqual(IDs('anthropic'), ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
  assert.ok(IDs('openai').includes('gpt-6.1-sol') && IDs('openai').includes('gpt-5.6-terra'));
  assert.ok(!IDs('openai').includes('gpt-5.4-nano'), 'documented deprecated model is not suggested');
  assert.ok(IDs('gemini').includes('gemini-4-argon') && IDs('gemini').includes('gemini-3.6-flash'));
  assert.ok(!IDs('gemini').includes('gemini-3.7-flash'), 'deprecated Gemini alias is excluded');
  assert.ok(IDs('glm').includes('glm-5.3-flashx') && IDs('glm').includes('glm-4.7-flashx'));
  assert.ok(IDs('grok').includes('grok-4.7') && IDs('grok').includes('latest'));
  assert.deepEqual(IDs('kimi'), ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6']);
  assert.ok(IDs('qwen').includes('qwen3.8-max') && IDs('qwen').includes('qwen3.8-omni-flash'));
  assert.ok(IDs('doubao').includes('doubao-seed-2-1-turbo-260628'));
  assert.ok(!IDs('doubao').includes('doubao-seed-2-1-turbo-260915'), 'unsupported date suffix is not guessed');
  assert.ok(!IDs('doubao').includes('doubao-seed-2.1-pro'), 'TeamoRouter dot-form ID is not inherited by the first-party gateway');
  assert.equal(defaultModelForGateway('openai'), 'gpt-6-luna');
  assert.equal(defaultModelForGateway('openai', '', ['gpt-live-only']), 'gpt-live-only', 'live account list wins over a fallback ID the account does not expose');
  assert.equal(DEFAULT_GATEWAY_ID, 'teamorouter');
});

test('manual model IDs are scoped to the custom gateway and cannot bypass provider validation', () => {
  const openai = gatewayFallbackModels('openai');
  const official = mergeAvailableModels([], openai, false, {
    gatewayId: 'openai', includeRouter: false, extraIds: ['qwen3.8-max', 'made-up-model'],
  });
  assert.deepEqual(official.map((model) => model.id), openai.map((model) => model.id));
  assert.equal(isModelForGateway('openai', 'qwen3.8-max', ['qwen3.8-max']), false);
  assert.equal(isModelForGateway('openai', 'gpt-6-luna'), true);
  assert.equal(isModelForGateway('openai', 'gpt-made-up'), false, 'same-provider manual IDs are not accepted without a live listing');
  assert.equal(isModelForGateway('openai', 'gpt-live-id', ['gpt-live-id']), true, 'successful API listing can authorize newly released same-provider IDs');
  assert.equal(isModelForGateway('custom', 'my-compatible-model'), true);
  const custom = mergeAvailableModels([], [], false, {
    gatewayId: 'custom', includeRouter: false, extraIds: ['my-compatible-model'],
  });
  assert.deepEqual(custom.map((model) => model.id), ['my-compatible-model']);
  assert.equal(gatewayFallbackModels('custom').length, 0);
  assert.match(gatewayModelListLabel('custom'), /×/);
});

test('live model lists remain filtered to chat models and each gateway provider', () => {
  assert.deepEqual(filterGatewayChatModels('anthropic', ['claude-opus-5-5', 'gpt-6-luna', 'claude-embedding']), ['claude-opus-5-5']);
  assert.deepEqual(filterGatewayChatModels('gemini', ['gemini-4-argon', 'gemini-3-pro-image', 'gemini-3.8-flash-tts']), ['gemini-4-argon']);
  assert.deepEqual(filterGatewayChatModels('qwen', ['qwen3.8-max', 'qwen-image-max', 'qwen3.8-flash']), ['qwen3.8-max', 'qwen3.8-flash']);
  assert.equal(isModelForGateway('glm', 'doubao-seed-2-1-pro-260915'), false);
  assert.equal(getGateway('glm').provider, 'GLM');
});

test('model-picker hidden providers use the requested internal labels and local logos load eagerly', () => {
  assert.equal(SMART_ROUTER_PROVIDER_LABEL, 'DUBHEROUTER');
  assert.match(providerIcon('Kimi'), /src="assets\/icons\/kimi\.svg"[^>]*loading="eager"/);
  const picker = fs.readFileSync(new URL('../js/ui-model-picker.js', import.meta.url), 'utf8');
  assert.match(picker, /<span>DUBHEAGENT<\/span>/);
  assert.match(picker, /prov = 'DUBHEAGENT'/);
  assert.match(picker, /filter\(m => isModelForGateway\(gatewayId, m\.id, liveKnown \? \(store\.state\.models \|\| \[\]\) : null\)\)/);
  assert.match(picker, /!isModelForGateway\(gatewayId, store\.state\.model, list\)/, 'a refreshed live list clears an unavailable selected model');
});

test('manual model controls are custom-only, aligned, deletable, and removing an active ID clears selection', async (t) => {
  let JSDOM;
  try { ({ JSDOM } = await import('jsdom')); } catch { t.skip('jsdom is not installed'); return; }
  const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://dubhe.test/app.html', pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent']) {
    if (window[key] !== undefined) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
  const { mountSettings } = await import('../js/settings.js');
  const store = {
    state: {
      gatewayId: 'teamorouter', apiKey: '', gatewayKeys: {}, gatewayBaseUrls: {}, modelsByGateway: {},
      modelsFetchedAtByGateway: {}, manualModelsByGateway: { teamorouter: ['old-manual-id'], custom: [] },
      models: [], modelsFetchedAt: 0, model: '__smart_router__', sessions: [], activeSessionId: '',
      settings: { theme: 'light', thinking: true, reasoningLevel: 'medium' },
    },
    notify() {}, subscribe() { return () => {}; },
  };
  mountSettings(store, { onGatewayChanged() {} });
  const $ = (selector) => window.document.querySelector(selector);
  const changeGateway = (id) => {
    $('#set-gateway').value = id;
    $('#set-gateway').dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const row = $('#set-manual-model-row'), input = $('#set-manual-model'), add = $('#set-add-model');
  assert.equal(row.hidden, true, 'manual entry is hidden on the built-in router');
  changeGateway('custom');
  assert.equal(row.hidden, false);
  input.value = 'my-compatible-model';
  add.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(store.state.manualModelsByGateway.custom, ['my-compatible-model']);
  assert.equal($('#set-manual-model-list-row').hidden, false);
  store.state.model = 'my-compatible-model';
  $('#set-manual-model-list button[data-remove-manual-model]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(store.state.manualModelsByGateway.custom, undefined);
  assert.equal(store.state.model, '', 'removing the selected custom model clears the selection');
  assert.equal($('#set-manual-model-list-row').hidden, true);
  changeGateway('openai');
  assert.equal(row.hidden, true, 'manual entry is hidden on first-party gateways');
  assert.equal(input.disabled, true);
  const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.set-select\s*\{[^}]*width:\s*230px/);
  assert.match(css, /\.set-ctl\.manual-model-controls\s*\{[^}]*width:\s*230px/);
  assert.match(css, /\.set-select\s*\{[^}]*width:\s*160px/);
  assert.match(html, /<h4>网关<\/h4>/);
});
