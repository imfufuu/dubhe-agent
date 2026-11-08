// Workers AI hosted catalog snapshot. Only explicitly enabled IDs may execute.
// Rates: neurons per million tokens, Cloudflare pricing checked 2026-11-04.
// Paid-only, deprecated, unsupported protocol or unpriced models stay disabled.
// Availability can change; the Worker, not this client-side snapshot, is authoritative.
export const CF_CHAT_MODELS = Object.freeze({
  '@cf/openai/gpt-oss-20b': { input: 18182, output: 27273, provider: 'OpenAI' },
  '@cf/openai/gpt-oss-120b': { input: 31818, output: 68182, provider: 'OpenAI' },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { input: 26668, output: 204805, provider: 'Meta' },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { input: 24545, output: 77273, provider: 'Meta' },
  '@cf/meta/llama-3.2-11b-vision-instruct': { input: 4410, output: 61493, provider: 'Meta' },
  '@cf/meta/llama-3.2-1b-instruct': { input: 2457, output: 18252, provider: 'Meta', plannedDeprecation: '2026-11-20' },
  '@cf/meta/llama-3.2-3b-instruct': { input: 4625, output: 30475, provider: 'Meta', plannedDeprecation: '2026-11-20' },
  '@cf/meta/llama-3.1-8b-instruct-fp8': { input: 13778, output: 26128, provider: 'Meta', plannedDeprecation: '2026-11-20' },
  '@cf/google/gemma-4-26b-a4b-it': { input: 9091, output: 27273, provider: 'Google' },
  '@cf/aisingapore/gemma-sea-lion-v4-27b-it': { input: 31876, output: 50488, provider: 'AI Singapore' },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { input: 31876, output: 50488, provider: 'Mistral AI' },
  '@cf/qwen/qwen2.5-coder-32b-instruct': { input: 60000, output: 90909, provider: 'Qwen' },
  '@cf/qwen/qwen3-30b-a3b-fp8': { input: 4625, output: 30475, provider: 'Qwen', plannedDeprecation: '2026-11-20' },
  '@cf/qwen/qwen3.8-27b': { input: 40909, output: 290909, provider: 'Qwen' },
  '@cf/qwen/qwq-32b': { input: 60000, output: 90909, provider: 'Qwen' },
  '@cf/zai-org/glm-4.7-flash': { input: 5500, output: 36400, provider: 'Zhipu AI' },
  '@cf/nvidia/nemotron-3-120b-a12b': { input: 45455, output: 136364, provider: 'NVIDIA' },
  '@cf/ibm-granite/granite-4.0-h-micro': { input: 1542, output: 10158, provider: 'IBM' },
  '@cf/daily-co/phonellm-mini-alpha-2': { input: 5455, output: 21818, provider: 'Daily' },
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': { input: 45170, output: 443756, provider: 'DeepSeek', plannedDeprecation: '2026-11-20' },
});
// Only models with an explicitly adapted function-calling protocol appear in the Agent picker.
export const CF_AGENT_CHAT_IDS = Object.freeze(['@cf/openai/gpt-oss-20b', '@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast']);
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
export function cfChatAvailable(id, now = new Date()) {
  const model = Object.hasOwn(CF_CHAT_MODELS, id) ? CF_CHAT_MODELS[id] : null;
  return !!model && (!model.plannedDeprecation || now.toISOString().slice(0, 10) < model.plannedDeprecation);
}
