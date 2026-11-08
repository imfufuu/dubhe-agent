import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { GATEWAY_CN, GATEWAY_GLOBAL, setGatewayBase } from '../js/endpoint.js';
import { routeModelForGateway } from '../js/smartrouter.js';
import { isCnUnavailableModel } from '../js/api.js';

const foreign = ['claude-sonnet-5-5', 'gpt-6-astra', 'gemini-3.8-flash', 'grok-4.7'];
test('smart router filters every .cn category and has a domestic empty fallback', () => {
  for (const input of ['写一个完整系统架构', '数学证明', '写一篇小说', '分析原因', '画一张图片', 'hello']) {
    const cn = routeModelForGateway(input, [...foreign, 'deepseek-flash', 'glm-5.3'], { base: GATEWAY_CN });
    assert.equal(isCnUnavailableModel(GATEWAY_CN, cn.chosenModel), false, input);
    assert.ok(['deepseek-flash', 'glm-5.3'].includes(cn.chosenModel));
    assert.equal(routeModelForGateway(input, foreign, { base: GATEWAY_CN }).chosenModel, 'deepseek-flash');
  }
  assert.equal(routeModelForGateway('hello', ['gemini-3.8-flash'], { base: GATEWAY_GLOBAL }).chosenModel, 'gemini-3.8-flash');
});

test('region switch restores last domestic model, then safe default when unavailable', async () => {
  const dom = new JSDOM(readFileSync(new URL('../app.html', import.meta.url), 'utf8'), { url: 'https://dubhe.test/app.html', pretendToBeVisual: true });
  const { window } = dom;
  for (const key of ['window','document','localStorage','HTMLElement','Element','Node','Event','CustomEvent','MouseEvent','navigator']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
  const { installModelPicker } = await import('../js/ui-model-picker.js');
  const state = { gatewayId: 'teamorouter', models: [], modelsFetchedAt: 0, model: '__smart_router__', settings: {}, offlineModelAvailable: false, imageModel: '', apiKey: '' };
  const store = { state, notify() {} };
  const noop = () => {};
  setGatewayBase(GATEWAY_GLOBAL);
  const picker = installModelPicker({ store, agent: { loadFiles: noop }, toast: noop, getBusy: () => false, openKeyModal: noop, rebuildMessages: noop, renderSessions: noop, renderFiles: noop, updateStats: noop, syncCapLine: noop, syncWeb: noop });
  globalThis.__dubheOfflineNetworkGate = { offline: true };
  picker.updateModelBtn();
  assert.equal(window.document.querySelector('#model-btn-name').textContent, 'smart_router', 'offline first boot with no GGUF does not display the local slot as selected');
  assert.equal(state.model, '__smart_router__');
  delete globalThis.__dubheOfflineNetworkGate;
  picker.selectModel('glm-5.3');
  picker.selectModel('claude-sonnet-5-5');
  setGatewayBase(GATEWAY_CN);
  assert.equal(state.model, 'glm-5.3');
  setGatewayBase(GATEWAY_GLOBAL);
  state.model = 'gpt-6-astra'; localStorage.setItem('dubhe-last-cn-chat-model', 'grok-4.7');
  setGatewayBase(GATEWAY_CN);
  assert.notEqual(state.model, 'grok-4.7');
  assert.equal(isCnUnavailableModel(GATEWAY_CN, state.model), false);
  state.model = 'claude-sonnet-5-5'; picker.updateModelBtn();
  assert.equal(isCnUnavailableModel(GATEWAY_CN, state.model), false, 'restoring an old session cannot reselect a foreign model');
  state.model = '__smart_router__'; setGatewayBase(GATEWAY_GLOBAL); setGatewayBase(GATEWAY_CN);
  assert.equal(state.model, '__smart_router__', 'smart router remains selected');
  dom.window.close();
});
