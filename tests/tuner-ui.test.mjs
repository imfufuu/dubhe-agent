// 输入框「调节器」面板：温度档位、Agent/对话环境、自注册工具确认与管理的真实 DOM 交互。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://dubhe.test/app.html', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
delete globalThis.localStorage; // tool-registry 退回内存存储，测试之间不污染

const reg = await import('../js/tool-registry.js');
reg.resetRegistryForTests();
const { installTuner } = await import('../js/ui-tuner.js');
const { policyTextHeuristic } = await import('../js/local-text-policy.js'); // 保证混版缓存下模块图可加载

const $ = (id) => document.getElementById(id);
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (el) => el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const store = {
  state: { tuner: null, settings: { thinking: true, reasoningLevel: 'medium' }, gatewayId: 'teamorouter' },
  notify() { this.calls = (this.calls || 0) + 1; },
};
const toasts = [];
const tuner = installTuner({ store, toast: (msg) => toasts.push(msg) });
assert.ok(tuner, '调节器必须挂载成功');

test('输入框里存在调节器图标按钮与面板', () => {
  const btn = $('tuner-btn');
  assert.ok(btn, '缺少 #tuner-btn');
  assert.equal(btn.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(btn.getAttribute('aria-controls'), 'tuner-panel');
  assert.ok($('tuner-panel'));
  assert.ok($('tuner-temp-options') && $('tuner-env-options') && $('tuner-tools-list'));
  assert.equal(typeof policyTextHeuristic, 'function');
});

test('温度：默认智能自调节，手动档位与自定义值即时生效', () => {
  tuner.render();
  const opts = $('tuner-temp-options').querySelectorAll('[data-temp]');
  assert.equal(opts.length, 6);
  assert.ok($('tuner-temp-options').querySelector('[data-temp="auto"]').classList.contains('on'));
  click($('tuner-temp-options').querySelector('[data-temp="precise"]'));
  assert.equal(store.state.tuner.temperatureMode, 'precise');
  assert.equal(tuner.environment().temperature, 0.15);
  assert.match($('tuner-temp-value').textContent, /0\.15/);
  click($('tuner-temp-options').querySelector('[data-temp="custom"]'));
  assert.equal($('tuner-custom-wrap').hidden, false);
  $('tuner-custom-range').value = '1.2';
  change($('tuner-custom-range'));
  assert.equal(store.state.tuner.customTemperature, 1.2);
  assert.equal(tuner.environment().temperature, 1.2);
  assert.ok(store.calls > 0, '设置必须触发持久化');
});

test('环境：Agent 模式可选思考等级并开放全部工具；对话模式零工具、思考可独立开关', () => {
  click($('tuner-env-options').querySelector('[data-env="agent"]'));
  const level = $('tuner-level');
  assert.ok(level.querySelector('[value="inherit"]'), '默认跟随设置页');
  level.value = 'ultra'; change(level);
  assert.equal(tuner.environment().reasoningLevel, 'ultra');
  assert.equal(tuner.environment().toolsEnabled, true);
  assert.match($('tuner-summary').textContent, /Agent/);

  click($('tuner-env-options').querySelector('[data-env="chat"]'));
  assert.equal($('tuner-chat-block').hidden, false);
  assert.equal($('tuner-agent-block').hidden, true);
  assert.equal(tuner.environment().toolsEnabled, false);
  assert.equal(tuner.environment().thinking, false);
  assert.match($('tuner-env-hint').textContent, /工具表为空|tool table is empty/i);
  const thinking = $('tuner-chat-thinking');
  thinking.checked = true; change(thinking);
  assert.equal(tuner.environment().thinking, true);
  assert.equal(tuner.environment().toolsEnabled, false, '开启思考也不得开放工具');
});

test('恢复默认把温度、环境、思考开关全部复位', () => {
  click($('tuner-reset'));
  assert.equal(store.state.tuner.temperatureMode, 'auto');
  assert.equal(store.state.tuner.environment, 'agent');
  assert.equal(store.state.tuner.agentReasoningLevel, 'inherit');
  assert.equal(tuner.environment().temperature, null);
});

test('自注册工具：待确认变更必须由用户点允许，之后可读取/删除', () => {
  tuner.open();
  const def = {
    name: 'custom_ui_tool', description: 'UI 测试工具',
    parameters: { type: 'object', properties: { who: { type: 'string' } } },
    handler: { kind: 'text_template', template: 'Hi {{who}}' },
  };
  const first = reg.handleRegistryAction({ action: 'register', definition: def });
  assert.match(first, /需要用户安全确认/);
  assert.equal($('tuner-pending').hidden, false, '待确认区应自动出现');
  click($('tuner-pending').querySelector('[data-act="allow"]'));
  assert.ok(reg.listRegisteredTools().some((t) => t.name === 'custom_ui_tool'));
  tuner.render();
  assert.match($('tuner-tools-list').textContent, /custom_ui_tool/);
  // 读取完整定义
  click($('tuner-tools-list').querySelector('[data-act="read"]'));
  assert.match($('tuner-tools-list').textContent, /text_template/);
  // 删除需要二次点击确认
  const del = $('tuner-tools-list').querySelector('[data-act="delete"]');
  click(del);
  assert.equal(reg.listRegisteredTools().length, 1, '第一次点击只进入确认态');
  const del2 = $('tuner-tools-list').querySelector('[data-act="delete"]');
  click(del2);
  assert.equal(reg.listRegisteredTools().length, 0);
  assert.equal($('tuner-pending').hidden, true);
});
