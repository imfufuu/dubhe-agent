// 调节器 v2：独立页面、无自定义滑杆/思考等级、对话模式裸聊、确认卡在输出里、工具管理迁到设置。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://dubhe.test/app.html', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
delete globalThis.localStorage;

const reg = await import('../js/tool-registry.js');
reg.resetRegistryForTests();
const { installTuner } = await import('../js/ui-tuner.js');
const { installToolManager } = await import('../js/ui-tool-manager.js');
const { installToolApproval } = await import('../js/tool-approval-card.js');

const $ = (id) => document.getElementById(id);
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const change = (el) => el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const store = {
  state: { tuner: null, settings: { thinking: true, reasoningLevel: 'medium' }, gatewayId: 'teamorouter' },
  notify() { this.calls = (this.calls || 0) + 1; },
};
const toasts = [];
installToolManager();
installToolApproval({ toast: (msg) => toasts.push(msg) });
const tuner = installTuner({ store, toast: (msg) => toasts.push(msg) });
assert.ok(tuner, '调节器必须挂载成功');

test('调节器是独立 modal 页面，不再挤在输入框里', () => {
  assert.equal($('tuner-btn').getAttribute('aria-controls'), 'tuner-modal');
  assert.ok($('tuner-modal').classList.contains('modal'));
  assert.equal($('tuner-modal').getAttribute('aria-modal'), 'true');
  assert.equal($('tuner-panel'), null);
  tuner.open();
  assert.equal($('tuner-modal').hidden, false);
  assert.ok($('tuner-modal').classList.contains('open'));
  tuner.close();
  assert.equal($('tuner-modal').classList.contains('open'), false, '关闭先移除 .open 播放淡出动画');
});

test('删除温度自定义/滑杆与 Agent 思考等级设置', () => {
  tuner.render();
  const opts = $('tuner-temp-options').querySelectorAll('[data-temp]');
  assert.equal(opts.length, 5, '只剩 自动/精确/严谨/均衡/创意');
  assert.equal($('tuner-temp-options').querySelector('[data-temp="custom"]'), null);
  assert.equal($('tuner-custom-wrap'), null);
  assert.equal($('tuner-custom-range'), null);
  assert.equal($('tuner-level'), null);
  assert.equal($('tuner-agent-block'), null);
  click($('tuner-temp-options').querySelector('[data-temp="precise"]'));
  assert.equal(store.state.tuner.temperatureMode, 'precise');
  assert.equal(tuner.environment().temperature, 0.15);
  assert.match($('tuner-temp-value').textContent, /0\.15/);
});

test('对话模式只注入一条身份声明且零工具；思考开关仍可独立切换', () => {
  click($('tuner-env-options').querySelector('[data-env="chat"]'));
  assert.equal($('tuner-chat-block').hidden, false);
  assert.equal(tuner.environment().toolsEnabled, false);
  assert.match($('tuner-env-hint').textContent, /只上传一条简短身份声明|only a short identity line/i);
  const thinking = $('tuner-chat-thinking');
  thinking.checked = true; change(thinking);
  assert.equal(tuner.environment().thinking, true);
  assert.equal(tuner.environment().toolsEnabled, false);
  const api = fs.readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../js/agent.js', import.meta.url), 'utf8');
  assert.match(api, /bareChat = false/);
  assert.match(api, /bareChat\s*\?\s*\[chatIdentityMessage\(model\)/);
  assert.match(agent, /唯一的简短身份声明由 api\.js/);
});

test('恢复默认复位温度、环境与思考开关', () => {
  click($('tuner-reset'));
  assert.equal(store.state.tuner.temperatureMode, 'auto');
  assert.equal(store.state.tuner.environment, 'agent');
  assert.equal(tuner.environment().temperature, null);
});

test('自注册工具管理迁到设置页，确认卡显示在输出中且「同意」不再回退成拒绝', () => {
  assert.ok($('tool-manager-root'), '设置页应有工具管理容器');
  assert.equal($('tuner-tools-list'), null, '调节器里不再有工具列表');
  const def = {
    name: 'custom_ui_tool', description: 'UI 测试工具',
    parameters: { type: 'object', properties: { who: { type: 'string' } } },
    handler: { kind: 'text_template', template: 'Hi {{who}}' },
  };
  const first = reg.handleRegistryAction({ action: 'register', definition: def });
  assert.match(first, /需要用户安全确认/);
  assert.match(first, /输出里的确认卡|confirmation card/i);
  const token = /confirm_token=([^\s。]+)/.exec(first)?.[1] || '';
  assert.ok(token, '应返回确认票据');
  const card = document.querySelector('#messages .confirm-card.tool-approval-card');
  assert.ok(card, '确认卡应出现在对话输出里');
  assert.match(card.className, /confirm-card/);
  click(card.querySelector('[data-act="allow"]'));
  assert.ok(reg.listRegisteredTools().some((x) => x.name === 'custom_ui_tool'), '点允许后变更立即生效');
  assert.match(card.textContent, /已批准|Approved/i);
  // 带回同一票据重试：必须返回「已批准」，不能重复注册，也不能报「用户拒绝 / 需要确认」。
  const retry = reg.handleRegistryAction({ action: 'register', definition: def, confirm_token: token });
  assert.match(retry, /已批准|已生效|无需重试|Approved|already|no retry/i);
  assert.doesNotMatch(retry, /拒绝|需要用户安全确认|已存在/);
  assert.equal(reg.listRegisteredTools().filter((x) => x.name === 'custom_ui_tool').length, 1);
  // 设置页管理工具列表同步
  installToolManager();
  assert.match($('tool-manager-root').textContent, /custom_ui_tool/);
});
