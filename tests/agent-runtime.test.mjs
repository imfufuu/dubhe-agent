// 回合环境内核（2026-11-08 架构优化）：单一决策层、默认行为不变、模式与温度策略一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TUNER_DEFAULTS, TEMPERATURE_PRESETS, REASONING_LEVEL_CHOICES, normalizeTuner,
  temperatureValueFor, resolveTurnEnvironment, toolDefinitionsForEnvironment,
  toolCallsForEnvironment, modelIdsForEnvironment, isValidReasoningLevel,
} from '../js/agent-runtime.js';

const settings = { thinking: true, reasoningLevel: 'medium' };
const env = (tuner, extra = {}) => resolveTurnEnvironment({ tuner, settings, ...extra });

test('默认值与坏数据归一化：默认不劫持设置页', () => {
  assert.equal(TUNER_DEFAULTS.temperatureMode, 'auto');
  assert.equal(TUNER_DEFAULTS.agentReasoningLevel, 'inherit');
  assert.deepEqual(normalizeTuner(null), TUNER_DEFAULTS);
  assert.deepEqual(normalizeTuner({ temperatureMode: 'bogus', environment: 'x', customTemperature: 99 }), {
    ...TUNER_DEFAULTS, customTemperature: 1.5,
  });
  const base = env();
  assert.equal(base.mode, 'agent');
  assert.equal(base.toolsEnabled, true);
  assert.equal(base.thinking, true);
  assert.equal(base.reasoningLevel, 'medium');
  assert.equal(base.temperature, null, '默认智能自调节：不下发数值，由 api.js resolveTemperature 决定');
  // 设置页思考 Off 仍然生效（回归：调节器不得静默覆盖用户设置）
  const off = env(null, { settings: { thinking: false, reasoningLevel: 'medium' } });
  assert.equal(off.thinking, false);
  assert.equal(off.reasoningLevel, 'off');
});

test('温度档位：智能自调节 + 四个手动档位（自定义已移除）', () => {
  assert.equal(temperatureValueFor({ temperatureMode: 'auto' }), null);
  assert.equal(temperatureValueFor({ temperatureMode: 'precise' }), 0.15);
  assert.equal(temperatureValueFor({ temperatureMode: 'creative' }), 0.95);
  // 旧版本存下来的 custom 自动回落到均衡档，UI 已不再提供自定义滑杆。
  assert.equal(temperatureValueFor({ temperatureMode: 'custom', customTemperature: 1.2 }), 0.65);
  assert.equal(TEMPERATURE_PRESETS.length, 5);
  assert.ok(TEMPERATURE_PRESETS.every((p) => p.id !== 'custom'));
  for (const preset of TEMPERATURE_PRESETS) assert.ok(preset.zh && preset.en && preset.hintZh && preset.hintEn);
  const precise = env({ temperatureMode: 'precise' });
  assert.equal(precise.temperature, 0.15);
  assert.match(precise.summaryEn, /T=0\.15/);
});

test('Agent 模式：思考等级可设定，全部工具可用', () => {
  assert.ok(REASONING_LEVEL_CHOICES.length >= 8);
  for (const level of ['off', 'mini', 'low', 'medium', 'high', 'max', 'ultra']) {
    const e = env({ environment: 'agent', agentReasoningLevel: level });
    assert.equal(e.toolsEnabled, true);
    assert.equal(e.reasoningLevel, level === 'off' ? 'off' : level);
    assert.equal(e.thinking, level !== 'off');
    assert.equal(isValidReasoningLevel(level), true);
  }
  assert.equal(isValidReasoningLevel('nonsense'), false);
  const defs = [{ name: 'a' }, { name: 'b' }];
  assert.deepEqual(toolDefinitionsForEnvironment(defs, env({ environment: 'agent' })), defs);
  assert.deepEqual(toolCallsForEnvironment([{ name: 'a' }], env({ environment: 'agent' })), [{ name: 'a' }]);
});

test('对话模式：零工具（含模型幻觉出的 tool_calls），思考开关独立', () => {
  const chat = env({ environment: 'chat' });
  assert.equal(chat.mode, 'chat');
  assert.equal(chat.toolsEnabled, false);
  assert.equal(chat.thinking, false);
  assert.equal(chat.reasoningLevel, 'off');
  assert.match(chat.summaryZh, /不调用工具/);
  assert.deepEqual(toolDefinitionsForEnvironment([{ name: 'read_file' }], chat), []);
  assert.deepEqual(toolCallsForEnvironment([{ name: 'read_file', args: {} }], chat), []);
  const thinking = env({ environment: 'chat', chatThinking: true, temperatureMode: 'creative' });
  assert.equal(thinking.thinking, true);
  assert.equal(thinking.reasoningLevel, 'medium');
  assert.equal(thinking.temperature, 0.95);
  assert.equal(thinking.toolsEnabled, false);
});

test('Workers AI：Agent 模式只保留支持 function calling 的模型，对话模式开放全部', () => {
  const ids = ['@cf/openai/gpt-oss-20b', '@cf/qwen/qwq-32b', '@cf/meta/llama-4-scout-17b-16e-instruct'];
  assert.deepEqual(modelIdsForEnvironment(ids, env({ environment: 'agent' }), 'cloudflare'), [ids[0]]);
  assert.deepEqual(modelIdsForEnvironment(ids, env({ environment: 'chat' }), 'cloudflare'), ids);
  assert.deepEqual(modelIdsForEnvironment(ids, env(), 'teamorouter'), ids);
});

test('接线：agent.js 与 api.js 使用统一环境，且工具表来自注册表唯一来源', () => {
  const agent = fs.readFileSync(new URL('../js/agent.js', import.meta.url), 'utf8');
  assert.match(agent, /resolveTurnEnvironment\(/);
  assert.match(agent, /temperature: turn\.temperature \?\? undefined/);
  assert.match(agent, /toolCallsForEnvironment\(acc\.result\(\), activeTurnEnv\)/);
  assert.match(agent, /liveToolDefs\(\)/);
  const api = fs.readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
  assert.match(api, /typeof temperature === 'number'\s*\?\s*\{ temperature, profile: 'custom'/);
  assert.match(api, /resolveTemperature\(\{ messages, plan, iteration, phase, subagentId \}\)/);
  const state = fs.readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
  assert.match(state, /tuner: \{ temperatureMode: 'auto'/);
});
