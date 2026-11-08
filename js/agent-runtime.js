// ─── 回合环境内核 / Turn Environment Kernel (2026-11-08 架构优化) ──────────────
// 以前一轮请求的行为被拆散在四处：设置页(thinking/reasoningLevel)、api.js(温度自动调控)、
// agent.js(工具表裁剪)、网关注册表(模型能力)。任一处只改一半就会出现「UI 显示 A、请求发出 B」。
// 本模块把「这一轮是什么环境」收敛为一个纯函数结果，供 UI、Agent 与 API 边界共同消费：
//
//   UI(调节器) ──写入 store.state.tuner──┐
//                                        ├─→ resolveTurnEnvironment() ─→ { mode, toolsEnabled,
//   设置页 / 网关能力 ───────────────────┘                                  thinking, reasoningLevel,
//                                                                          temperature }
//                                                    └─→ agent.js(工具表/请求) · api.js(温度)
//
// 纯函数、无 DOM、无网络依赖；默认输出与优化前完全一致（Agent 模式 + 智能自调节 + medium）。
import { REASONING_LEVELS, normalizeReasoningLevel } from './reasoning.js?v=2026.10.25.1';
import { gatewayAgentToolModelIds } from './gateway-registry.js?v=2026.10.25.1';

export const TUNER_DEFAULTS = Object.freeze({
  temperatureMode: 'auto',   // auto | precise | focused | balanced | creative | custom
  customTemperature: 0.7,    // 仅 custom 使用
  environment: 'agent',      // agent | chat
  agentReasoningLevel: 'inherit',  // inherit = 沿用设置页；调节器里明确选档才覆盖
  chatThinking: false,
});

export const TEMPERATURE_PRESETS = Object.freeze([
  { id: 'auto', value: null, zh: '智能自调节', en: 'Adaptive', hintZh: '按任务类型、工具阶段与路由结果自动选择温度', hintEn: 'Picks a temperature from task type, tool phase and routing' },
  { id: 'precise', value: 0.15, zh: '精确', en: 'Precise', hintZh: '代码、数学、工具参数等确定性任务', hintEn: 'Code, math and exact tool arguments' },
  { id: 'focused', value: 0.35, zh: '严谨', en: 'Focused', hintZh: '事实问答、技术核对，抑制发散', hintEn: 'Factual answers and technical checks' },
  { id: 'balanced', value: 0.65, zh: '均衡', en: 'Balanced', hintZh: '日常对话与概念讲解', hintEn: 'Everyday conversation and explanations' },
  { id: 'creative', value: 0.95, zh: '创意', en: 'Creative', hintZh: '故事、诗歌、文案与头脑风暴', hintEn: 'Stories, poetry, copywriting and brainstorming' },
  { id: 'custom', value: null, zh: '自定义', en: 'Custom', hintZh: '手动指定 0–1.5 之间的数值', hintEn: 'Set an explicit value between 0 and 1.5' },
]);
export const REASONING_LEVEL_CHOICES = Object.freeze([
  { id: 'inherit', zh: '跟随设置', en: 'Follow settings' },
  { id: 'off', zh: '关闭思考', en: 'Off' },
  { id: 'mini', zh: '极速', en: 'Mini' },
  { id: 'low', zh: '轻量', en: 'Low' },
  { id: 'medium', zh: '均衡', en: 'Medium' },
  { id: 'high', zh: '深入', en: 'High' },
  { id: 'max', zh: '可委派', en: 'Max' },
  { id: 'ultra', zh: '多专家复核', en: 'Ultra' },
]);

const MODE_IDS = new Set(TEMPERATURE_PRESETS.map((p) => p.id));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** 容错归一化：坏数据、旧版本、手工编辑 localStorage 都不会让 UI 或 Agent 崩掉。 */
export function normalizeTuner(raw) {
  const t = (raw && typeof raw === 'object') ? raw : {};
  const temperatureMode = MODE_IDS.has(t.temperatureMode) ? t.temperatureMode : TUNER_DEFAULTS.temperatureMode;
  const customTemperature = Number.isFinite(Number(t.customTemperature))
    ? Math.round(clamp(Number(t.customTemperature), 0, 1.5) * 100) / 100
    : TUNER_DEFAULTS.customTemperature;
  const rawLevel = String(t.agentReasoningLevel ?? TUNER_DEFAULTS.agentReasoningLevel).toLowerCase();
  const agentReasoningLevel = ['inherit', 'off'].includes(rawLevel) ? rawLevel : normalizeReasoningLevel(rawLevel);
  return {
    temperatureMode,
    customTemperature,
    environment: t.environment === 'chat' ? 'chat' : 'agent',
    agentReasoningLevel,
    chatThinking: t.chatThinking === true,
  };
}

export function temperatureValueFor(tuner) {
  const t = normalizeTuner(tuner);
  if (t.temperatureMode === 'auto') return null;             // null = api.js 走智能自调节
  if (t.temperatureMode === 'custom') return t.customTemperature;
  return TEMPERATURE_PRESETS.find((p) => p.id === t.temperatureMode)?.value ?? null;
}

/**
 * 解析本轮唯一的环境决策。所有调用方都读这个对象，不再各自解释设置项。
 * @returns {{mode:string, toolsEnabled:boolean, thinking:boolean, reasoningLevel:string,
 *            temperature:number|null, temperatureMode:string, tuner:object,
 *            settingsOverrides:object, summaryZh:string, summaryEn:string}}
 */
export function resolveTurnEnvironment({ tuner, settings = {}, gatewayId = '' } = {}) {
  const t = normalizeTuner(tuner);
  const chat = t.environment === 'chat';
  const temperature = temperatureValueFor(t);
  let thinking, reasoningLevel;
  if (chat) {
    // 对话模式：可开关思考，绝不开放任何工具。
    thinking = t.chatThinking;
    reasoningLevel = t.chatThinking ? normalizeReasoningLevel(settings.reasoningLevel || 'medium') : 'off';
  } else if (t.agentReasoningLevel === 'inherit') {
    // 默认不劫持设置页：用户没在调节器里选档时，行为与优化前完全一致。
    thinking = settings.thinking !== false;
    reasoningLevel = thinking ? normalizeReasoningLevel(settings.reasoningLevel || 'medium') : 'off';
  } else {
    // Agent 模式：思考等级由调节器决定，全部工具可用。
    thinking = t.agentReasoningLevel !== 'off';
    reasoningLevel = thinking ? normalizeReasoningLevel(t.agentReasoningLevel) : 'off';
  }
  const tempLabel = TEMPERATURE_PRESETS.find((p) => p.id === t.temperatureMode);
  const tempText = t.temperatureMode === 'auto'
    ? { zh: '智能自调节', en: 'adaptive' }
    : { zh: `${tempLabel?.zh || t.temperatureMode} T=${temperature}`, en: `${tempLabel?.en || t.temperatureMode} T=${temperature}` };
  const levelId = chat ? (t.chatThinking ? reasoningLevel : 'off')
    : (t.agentReasoningLevel === 'inherit' ? (thinking ? reasoningLevel : 'off') : t.agentReasoningLevel);
  const levelText = REASONING_LEVEL_CHOICES.find((l) => l.id === levelId);
  return {
    mode: chat ? 'chat' : 'agent',
    toolsEnabled: !chat,
    thinking,
    reasoningLevel,
    temperature,                       // 数值 = 手动档；null = 智能自调节
    temperatureMode: t.temperatureMode,
    tuner: t,
    settingsOverrides: { thinking, reasoningLevel },
    summaryZh: chat
      ? `对话模式 · ${t.chatThinking ? `思考${levelText?.zh || ''}` : '不思考'} · 不调用工具 · ${tempText.zh}`
      : `Agent 模式 · 思考${levelText?.zh || ''} · 全部工具 · ${tempText.zh}`,
    summaryEn: chat
      ? `Chat · ${t.chatThinking ? 'thinking on' : 'thinking off'} · no tools · ${tempText.en}`
      : `Agent · ${levelText?.en || ''} thinking · all tools · ${tempText.en}`,
  };
}

/** 工具表在策略门处统一裁剪：对话模式无论模型返回什么都不允许执行工具。 */
export function toolDefinitionsForEnvironment(defs, env) {
  return env?.toolsEnabled === false ? [] : (Array.isArray(defs) ? defs : []);
}
/** 工具调用的最后一道理闸门（防止模型在对话模式幻觉出 tool_calls）。 */
export function toolCallsForEnvironment(calls, env) {
  return env?.toolsEnabled === false ? [] : (Array.isArray(calls) ? calls : []);
}

/** 模型可用性提示：Workers AI 的 chat-only 模型在 Agent 模式下不能接收工具。 */
export function modelIdsForEnvironment(ids, env, gatewayId = '') {
  const list = Array.isArray(ids) ? ids : [];
  if (env?.toolsEnabled === false) return list;
  const agentIds = gatewayAgentToolModelIds(gatewayId);
  if (!agentIds) return list;
  return list.filter((id) => agentIds.includes(String(id)));
}

export function isValidReasoningLevel(value) {
  return value === 'off' || REASONING_LEVELS.includes(value);
}
