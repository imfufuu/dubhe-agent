// Workers AI hosted catalog snapshot. Only explicitly enabled IDs may execute.
// Rates: neurons per million tokens, Cloudflare pricing checked 2026-11-04.
// Paid-only, deprecated, unsupported protocol or unpriced models stay disabled.
// Availability can change; the Worker, not this client-side snapshot, is authoritative.
//
// 2026-11-08: every enabled model is now exposed through GET /v1/models (previously only the
// three function-calling models were listed). `agentTools` marks the subset that can receive
// function tools; chat-only models remain available for the tool-free conversation mode.
// `vendor` is the model author and `provider` is the serving platform shown on model cards —
// displaying "OpenAI"/"Meta" as the *gateway* provider was the source of the card bug.
export const CF_CHAT_MODELS = Object.freeze({
  '@cf/openai/gpt-oss-20b': { input: 18182, output: 27273, vendor: 'OpenAI', provider: 'Cloudflare', label: 'GPT-OSS 20B', agentTools: true },
  '@cf/openai/gpt-oss-120b': { input: 31818, output: 68182, vendor: 'OpenAI', provider: 'Cloudflare', label: 'GPT-OSS 120B', agentTools: true },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 26668, output: 204805, vendor: 'Meta', provider: 'Cloudflare', label: 'Llama 3.3 70B Fast', agentTools: true },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 24545, output: 77273, vendor: 'Meta', provider: 'Cloudflare', label: 'Llama 4 Scout 17B', agentTools: false },
  '@cf/meta/llama-3.2-11b-vision-instruct': { input: 4410, output: 61493, vendor: 'Meta', provider: 'Cloudflare', label: 'Llama 3.2 11B Vision', agentTools: false },
  '@cf/meta/llama-3.2-1b-instruct': { input: 2457, output: 18252, vendor: 'Meta', provider: 'Cloudflare', label: 'Llama 3.2 1B', plannedDeprecation: '2026-11-20', agentTools: false },
  '@cf/meta/llama-3.2-3b-instruct': { input: 4625, output: 30475, vendor: 'Meta', provider: 'Cloudflare', label: 'Llama 3.2 3B', plannedDeprecation: '2026-11-20', agentTools: false },
  '@cf/meta/llama-3.1-8b-instruct-fp8': { input: 13778, output: 26128, vendor: 'Meta', provider: 'Cloudflare', label: 'Llama 3.1 8B FP8', plannedDeprecation: '2026-11-20', agentTools: false },
  '@cf/google/gemma-4-26b-a4b-it': { input: 9091, output: 27273, vendor: 'Google', provider: 'Cloudflare', label: 'Gemma 4 26B', agentTools: false },
  '@cf/aisingapore/gemma-sea-lion-v4-27b-it': { input: 31876, output: 50488, vendor: 'AI Singapore', provider: 'Cloudflare', label: 'SEA-LION v4 27B', agentTools: false },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { input: 31876, output: 50488, vendor: 'Mistral AI', provider: 'Cloudflare', label: 'Mistral Small 3.1 24B', agentTools: false },
  '@cf/qwen/qwen2.5-coder-32b-instruct': { input: 60000, output: 90909, vendor: 'Qwen', provider: 'Cloudflare', label: 'Qwen2.5 Coder 32B', agentTools: false },
  '@cf/qwen/qwen3-30b-a3b-fp8': { input: 4625, output: 30475, vendor: 'Qwen', provider: 'Cloudflare', label: 'Qwen3 30B A3B', plannedDeprecation: '2026-11-20', agentTools: false },
  '@cf/qwen/qwen3.8-27b': { input: 40909, output: 290909, vendor: 'Qwen', provider: 'Cloudflare', label: 'Qwen3.8 27B', agentTools: false },
  '@cf/qwen/qwq-32b': { input: 60000, output: 90909, vendor: 'Qwen', provider: 'Cloudflare', label: 'QwQ 32B', agentTools: false },
  '@cf/zai-org/glm-4.7-flash': { input: 5500, output: 36400, vendor: 'Zhipu AI', provider: 'Cloudflare', label: 'GLM 4.7 Flash', agentTools: false },
  '@cf/nvidia/nemotron-3-120b-a12b': { input: 45455, output: 136364, vendor: 'NVIDIA', provider: 'Cloudflare', label: 'Nemotron 3 120B', agentTools: false },
  '@cf/ibm-granite/granite-4.0-h-micro': { input: 1542, output: 10158, vendor: 'IBM', provider: 'Cloudflare', label: 'Granite 4.0 H Micro', agentTools: false },
  '@cf/daily-co/phonellm-mini-alpha-2': { input: 5455, output: 21818, vendor: 'Daily', provider: 'Cloudflare', label: 'PhoneLLM Mini Alpha 2', agentTools: false },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { input: 45170, output: 443756, vendor: 'DeepSeek', provider: 'Cloudflare', label: 'DeepSeek R1 Distill 32B', plannedDeprecation: '2026-11-20', agentTools: false },
});
// Only models with an explicitly adapted function-calling protocol may receive tools.
// 2026-11-08：Workers AI 模型卡片只使用两种标签 —— 流行（人工精选）与低价（Neurons 费率阈值）。
// 供应商/原厂、AGENT/CHAT、FREE、视觉等旧 badge 全部撤下，能力信息保留在 tooltip 里。
export const CF_POPULAR_IDS = Object.freeze([
  '@cf/openai/gpt-oss-20b', '@cf/openai/gpt-oss-120b',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/qwen/qwen3.8-27b', '@cf/zai-org/glm-4.7-flash',
]);
export const CF_CHEAP_INPUT_MAX = 6000;   // Neurons / 1M input tokens
export const CF_CHEAP_OUTPUT_MAX = 40000; // Neurons / 1M output tokens
export function cfModelTags(id) {
  const m = Object.hasOwn(CF_CHAT_MODELS, id) ? CF_CHAT_MODELS[id] : null;
  if (!m) return [];
  const tags = [];
  if (CF_POPULAR_IDS.includes(id)) tags.push('popular');
  if (Number(m.input) <= CF_CHEAP_INPUT_MAX && Number(m.output) <= CF_CHEAP_OUTPUT_MAX) tags.push('cheap');
  return tags;
}

export const CF_AGENT_CHAT_IDS = Object.freeze(Object.keys(CF_CHAT_MODELS).filter(id => CF_CHAT_MODELS[id].agentTools === true));
export const CF_DISABLED_PAID = Object.freeze([
  '@cf/deepseek-ai/deepseek-v4-flash-0731', '@cf/deepseek-ai/deepseek-v4-pro-0813', '@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  '@cf/zai-org/glm-5.2', '@cf/zai-org/glm-5.3', '@cf/zai-org/glm-5.3-flash',
  '@cf/moonshotai/kimi-k2.6', '@cf/moonshotai/kimi-k2.7-code',
]);
export const CF_VISION_MODEL = '@cf/moondream/moondream3.1-9B-A2B';
export const CF_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
export const CF_DECISION_MODELS = Object.freeze({
  '@cf/cloudflare/clef': { input: 21818, selector: 'clef' },
  '@cf/cloudflare/clef-flash': { input: 3455, selector: 'clef-flash' },
  '@cf/cloudflare/clef-omni': { input: 13636, selector: 'clef-omni' },
  '@cf/cloudflare/clairic': { input: 9091, selector: 'clairic', extraction: true },
});

// Model IDs historically differed in casing between the client vision helper, pricing and the
// Worker (…9b-a2b vs …9B-A2B). Resolve case-insensitively so a mismatch never yields HTTP 400.
const CANONICAL_IDS = Object.freeze([
  ...Object.keys(CF_CHAT_MODELS), CF_VISION_MODEL, CF_IMAGE_MODEL, ...Object.keys(CF_DECISION_MODELS),
]);
const CANONICAL_BY_LOWER = Object.freeze(new Map(CANONICAL_IDS.map(id => [id.toLowerCase(), id])));
export function cfCanonicalModelId(id, allowed = null) {
  const key = String(id || '').trim().toLowerCase();
  const canonical = CANONICAL_BY_LOWER.get(key) || '';
  if (!canonical) return '';
  if (allowed && !allowed.some(a => String(a).toLowerCase() === canonical.toLowerCase())) return '';
  return canonical;
}
export function cfChatAvailable(id, now = new Date()) {
  const model = Object.hasOwn(CF_CHAT_MODELS, id) ? CF_CHAT_MODELS[id] : null;
  return !!model && (!model.plannedDeprecation || now.toISOString().slice(0, 10) < model.plannedDeprecation);
}
export function cfModelCard(id) {
  const model = Object.hasOwn(CF_CHAT_MODELS, id) ? CF_CHAT_MODELS[id] : null;
  if (!model) return null;
  return {
    id,
    displayName: model.label || id,
    provider: model.provider || 'Cloudflare',
    vendor: model.vendor || '',
    agentTools: model.agentTools === true,
    tags: cfModelTags(id),
    plannedDeprecation: model.plannedDeprecation || null,
    // Neurons, not USD: never let a USD rate card render a bogus chart for hosted models.
    pricing: { unit: 'neurons', input: model.input, output: model.output, currency: null },
  };
}
