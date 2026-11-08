// 自注册工具：注册 / 读取 / 更新 / 启停 / 删除 / 调用，以及用户确认票据与声明式 handler 安全边界。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resetRegistryForTests, handleRegistryAction, registerTool, approvePending, denyPending,
  pendingApprovals, listRegisteredTools, readRegisteredTool, registeredToolDefinitions,
  invokeRegisteredTool, HANDLER_KINDS,
} from '../js/tool-registry.js';
import { allToolDefinitions, TOOL_DEFS, executeTool } from '../js/tools.js';
import { createFS } from '../js/sandbox.js';

const DEFINITION = {
  name: 'custom_greet', description: '向指定的人打招呼',
  parameters: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] },
  handler: { kind: 'text_template', template: '你好，{{who}}！' },
};

function fresh() {
  delete globalThis.localStorage; // 强制内存存储，避免测试间互相污染
  resetRegistryForTests();
}
/** 模拟「Agent 发起 → 用户点允许 → Agent 带票据重试」。 */
function registerWithApproval(def) {
  const first = handleRegistryAction({ action: 'register', definition: def });
  const pending = pendingApprovals().find((p) => p.summary.includes(def.name));
  assert.ok(pending, `注册 ${def.name} 应产生待确认项`);
  assert.equal(approvePending(pending.token), true, '模拟用户在调节器点「允许」');
  const result = handleRegistryAction({ action: 'register', definition: def, confirm_token: pending.token });
  return { first, result, token: pending.token };
}
function mutateWithApproval(args) {
  const first = handleRegistryAction(args);
  const pending = pendingApprovals()[0];
  assert.ok(pending, `${args.action} 应产生待确认项`);
  assert.equal(approvePending(pending.token), true);
  return { first, result: handleRegistryAction({ ...args, confirm_token: pending.token }) };
}

test('注册需要用户确认：无票据不改动数据，批准后可带一次性票据重试', () => {
  fresh();
  const first = handleRegistryAction({ action: 'register', definition: DEFINITION });
  assert.match(first, /需要用户安全确认/);
  assert.equal(listRegisteredTools().length, 0, '第一次调用只产生待确认项');
  const token = pendingApprovals()[0].token;
  assert.equal(approvePending(token), true, '模拟用户点「允许」');
  const result = handleRegistryAction({ action: 'register', definition: DEFINITION, confirm_token: token });
  assert.match(result, /"ok": true/);
  assert.equal(listRegisteredTools().length, 1);
  assert.equal(pendingApprovals().length, 0);
  assert.equal(approvePending(token), false, '票据只能消费一次');
});

test('Agent 不能自行批准：拒绝后重试不生效，工具侧没有 approve 动作', () => {
  fresh();
  const first = handleRegistryAction({ action: 'register', definition: DEFINITION });
  assert.match(first, /confirm_token/);
  const token = pendingApprovals()[0].token;
  assert.equal(denyPending(token), true);
  const retry = registerTool(DEFINITION, { confirmToken: token });
  assert.equal(retry.needsConfirmation, true, '被拒绝的票据不能完成注册');
  assert.equal(listRegisteredTools().length, 0);
  assert.match(handleRegistryAction({ action: 'approve', confirm_token: token }), /未知 action/);
  assert.match(handleRegistryAction({ action: 'help' }), /list, read, register/);
});

test('读取、更新、启停、删除都要确认；内置工具不可覆盖或删除', () => {
  fresh();
  registerWithApproval(DEFINITION);
  assert.match(handleRegistryAction({ action: 'read', name: 'custom_greet' }), /text_template/);
  assert.match(handleRegistryAction({ action: 'list' }), /custom_greet/);
  assert.equal(registeredToolDefinitions().length, 1);

  const upd = mutateWithApproval({ action: 'update', name: 'custom_greet', patch: { description: '新的说明' } });
  assert.match(upd.first, /需要用户安全确认/);
  assert.match(upd.result, /"ok": true/);
  assert.match(readRegisteredTool('custom_greet').description, /新的说明/);

  const dis = mutateWithApproval({ action: 'disable', name: 'custom_greet' });
  assert.match(dis.first, /需要用户安全确认/);
  assert.equal(registeredToolDefinitions().length, 0, '停用后不再下发给模型');
  assert.throws(() => invokeRegisteredTool('custom_greet', { who: 'A' }), /已停用/);

  const en = mutateWithApproval({ action: 'enable', name: 'custom_greet' });
  assert.match(en.result, /"ok": true/);
  assert.equal(registeredToolDefinitions().length, 1);

  assert.match(handleRegistryAction({ action: 'delete', name: 'read_file' }), /找不到自注册工具/);
  assert.throws(() => registerTool({ ...DEFINITION, name: 'read_file' }), /custom_/);
  assert.throws(() => registerTool({ ...DEFINITION, name: 'custom_bad', handler: { kind: 'eval', code: 'process.exit(1)' } }), /handler.kind/);
  const del = mutateWithApproval({ action: 'delete', name: 'custom_greet' });
  assert.match(del.result, /"ok": true/);
  assert.equal(listRegisteredTools().length, 0);
  assert.ok(HANDLER_KINDS.includes('calculator'));
});

test('声明式 handler 全部可用，且模型提供的代码永远不会被执行', () => {
  fresh();
  registerWithApproval(DEFINITION);
  assert.equal(invokeRegisteredTool('custom_greet', { who: '小明' }), '你好，小明！');
  assert.throws(() => invokeRegisteredTool('custom_greet', {}), /缺少必填参数/);
  assert.doesNotThrow(() => invokeRegisteredTool('custom_greet', { who: 'x', extra: 'y' }));

  const calc = {
    name: 'custom_calc', description: '安全四则运算',
    parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
    handler: { kind: 'calculator' },
  };
  registerWithApproval(calc);
  assert.equal(invokeRegisteredTool('custom_calc', { expression: '2+3*4' }), '14');
  assert.equal(invokeRegisteredTool('custom_calc', { expression: '2^5' }), '32');
  assert.throws(() => invokeRegisteredTool('custom_calc', { expression: 'process.exit(1)' }), /算式/);
  assert.throws(() => invokeRegisteredTool('custom_calc', { expression: 'alert(1)' }), /算式/);

  const transform = {
    name: 'custom_upper', description: '转大写',
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    handler: { kind: 'text_transform', op: 'upper' },
  };
  registerWithApproval(transform);
  assert.equal(invokeRegisteredTool('custom_upper', { text: 'abc' }), 'ABC');
});

test('工具表唯一来源与真实执行路径：注册后模型可见、executeTool 可调用', async () => {
  fresh();
  assert.equal(allToolDefinitions().length, TOOL_DEFS.length);
  registerWithApproval(DEFINITION);
  const defs = allToolDefinitions();
  assert.equal(defs.length, TOOL_DEFS.length + 1);
  assert.ok(defs.some((d) => d.name === 'custom_greet' && d.parameters.properties.who));
  assert.ok(!defs.some((d) => d.name === 'custom_greet' && d.handler), 'handler 内部实现不下发给模型');
  const out = await executeTool('custom_greet', { who: 'Ada' }, { fs: createFS(), onUi: () => {} });
  assert.match(String(out), /你好，Ada/);
  const registryOut = await executeTool('tool_registry', { action: 'read', name: 'custom_greet' }, { fs: createFS(), onUi: () => {} });
  assert.match(String(registryOut), /text_template/);
});

test('中风险工具每次调用都要单独确认', () => {
  fresh();
  const def = { ...DEFINITION, name: 'custom_risky', risk: 'medium' };
  registerWithApproval(def);
  const first = invokeRegisteredTool('custom_risky', { who: 'A' });
  assert.equal(first.needsConfirmation, true);
  const token = pendingApprovals()[0].token;
  assert.equal(approvePending(token), true);
  assert.equal(invokeRegisteredTool('custom_risky', { who: 'A' }, { confirmToken: token }), '你好，A！');
  assert.equal(invokeRegisteredTool('custom_risky', { who: 'B' }).needsConfirmation, true, '票据一次性，下一次调用仍需确认');
});
