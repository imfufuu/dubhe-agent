// 推理级别（独立文件，避免给 config/api 加新具名导出导致 Pages 混版缓存白屏）
export const REASONING_LEVELS = ['mini', 'low', 'medium', 'high', 'max', 'ultra'];

const CLAUDE_BUDGET = {
  mini: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  max: 16384,
  ultra: 32768,
};

// GPT：minimal / low / medium / high / xhigh
// Gemini 3 thinkingLevel：minimal / low / medium / high（更高档位映射到 high）
// Grok：常见 low / medium / high
// High < Max < Ultra。GPT 上游最高是 xhigh（Max/Ultra 同档），Ultra 的多余能力在预算、输出帽和强制自检/多专家。
const OPENAI_EFFORT = { mini: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'xhigh', ultra: 'xhigh' };
const GEMINI_EFFORT = { mini: 'minimal', low: 'low', medium: 'medium', high: 'high', max: 'high', ultra: 'high' };
const GROK_EFFORT = { mini: 'low', low: 'low', medium: 'medium', high: 'high', max: 'high', ultra: 'high' };

const LABELS = { mini: 'Mini', low: 'Low', medium: 'Medium', high: 'High', max: 'Max', ultra: 'Ultra' };
const HINTS = {
  mini: '极速',
  low: '轻量',
  medium: '均衡',
  high: '深入',
  max: '可委派',
  ultra: '多专家复核',
};

export function normalizeReasoningLevel(v) {
  const s = String(v || '').toLowerCase();
  return REASONING_LEVELS.includes(s) ? s : 'medium';
}

export function reasoningLevelLabel(v) {
  return LABELS[normalizeReasoningLevel(v)];
}

export function reasoningLevelHint(v) {
  return HINTS[normalizeReasoningLevel(v)];
}

export function claudeThinkingBudget(level) {
  return CLAUDE_BUDGET[normalizeReasoningLevel(level)];
}

export function reasoningEffortFor(modelId, level) {
  const lv = normalizeReasoningLevel(level);
  const m = String(modelId || '').toLowerCase();
  if (m.startsWith('gemini')) return GEMINI_EFFORT[lv];
  if (m.startsWith('grok')) return GROK_EFFORT[lv];
  return OPENAI_EFFORT[lv];
}

// Native capability matrix, not an output-length budget. Sources (checked 2026-10-14):
// https://api-docs.deepseek.com/guides/thinking_mode/
// https://docs.bigmodel.cn/cn/guide/capabilities/thinking
const THREE_EFFORT = { mini: 'low', low: 'low', medium: 'high', high: 'high', max: 'max', ultra: 'max' };
export function reasoningControlFor(modelId, level) {
  const m = String(modelId || '').toLowerCase(), lv = normalizeReasoningLevel(level);
  if (m.startsWith('claude')) return { kind: 'budget', native: claudeThinkingBudget(lv), params: { thinking: { type: 'enabled', budget_tokens: claudeThinkingBudget(lv) } } };
  if (/^deepseek-(?:v4(?:-|$)|flash$|pro$)/.test(m))
    return { kind: 'effort', native: THREE_EFFORT[lv], params: { thinking: { type: 'enabled' }, reasoning_effort: THREE_EFFORT[lv] } };
  if (m.startsWith('deepseek')) return { kind: 'toggle', params: { reasoning: true } }; // legacy gateway contract
  const glm = /^glm-(\d+)(?:\.(\d+))?/.exec(m);
  if (glm) {
    const version = Number(glm[1]) + Number(glm[2] || 0) / 10;
    if (version >= 5.2) {
      const effort = version < 5.3 && ['mini', 'low'].includes(lv) ? 'high' : THREE_EFFORT[lv];
      return { kind: 'effort', native: effort, alwaysThinking: version >= 5.3, params: { thinking: { type: 'enabled' }, reasoning_effort: effort } };
    }
    return { kind: 'toggle', params: { thinking: { type: 'enabled' } } };
  }
  if (/^(gpt-[5-9]|o[134](?:-|$)|gemini|grok)/.test(m)) {
    const effort = /^o[134](?:-|$)/.test(m) ? ({ mini: 'low', low: 'low', medium: 'medium', high: 'high', max: 'high', ultra: 'high' })[lv] : reasoningEffortFor(m, lv);
    return { kind: 'effort', native: effort, params: { reasoning_effort: effort } };
  }
  // Unknown/non-reasoning routes: never invent reasoning_effort support.
  return { kind: 'guided', params: {} };
}

const EFFORT_GUIDES = {
  mini: 'Take the shortest sound path. For a straightforward task, answer directly after a quick sanity check; do not explore alternatives without a concrete uncertainty.',
  low: 'Identify the key constraint and check the most likely failure point. Prefer one practical approach; investigate further only when evidence is uncertain.',
  medium: 'Break down nontrivial tasks, check key assumptions and verify the central result. Compare alternatives only if they materially affect the answer.',
  high: 'For nontrivial tasks, compare two materially different approaches, test relevant boundary cases and seek a counterexample to the central claim before concluding.',
  max: 'For nontrivial tasks, compare alternatives and independently verify the critical result with a different method or relevant available evidence. Use an available specialist only if it adds independent expertise.',
  ultra: 'For nontrivial tasks, independently cross-check critical claims, stress-test failure modes and resolve conflicting evidence before finalizing. Use relevant available specialist review where useful; distinguish verified results from residual uncertainty.',
};
export function reasoningStrategy(level) {
  const lv = normalizeReasoningLevel(level);
  return `[Dubhe effort: ${LABELS[lv]}]\n${EFFORT_GUIDES[lv]}\nThis is a task-scaled verification policy, not a fixed token budget or a demand for longer output. Keep private reasoning private; report concise conclusions, evidence and limits. Simple requests remain simple at every level. Stop when the requested result is adequately supported. Never fabricate verification or repeat side-effecting actions just to satisfy a tier. Use only authorized tools actually available; if verification is unavailable, state the limit. Match the user's requested language and format.`;
}
export function withReasoningStrategy(messages, { thinking = false, level = 'medium' } = {}) {
  if (!thinking) return messages;
  // Request-local only: never persist this policy into history or duplicate it on retries.
  const at = messages.findIndex((m) => m.role === 'system');
  if (at < 0) return [{ role: 'system', text: reasoningStrategy(level) }, ...messages];
  return messages.map((m, i) => i === at ? { ...m, text: `${m.text || ''}\n\n${reasoningStrategy(level)}` } : m);
}
export function reasoningControlHint(modelId, level) {
  if (['smart_router', '__smart_router__'].includes(modelId)) return '随路由模型适配原生控制 + 分级验证';
  const c = reasoningControlFor(modelId, level);
  if (c.kind === 'budget') return `原生思考预算 ${c.native} + 分级验证`;
  if (c.kind === 'effort') return `原生 ${c.native} + 分级验证（非输出预算）`;
  return '分级验证引导（软控制，非原生预算）';
}
