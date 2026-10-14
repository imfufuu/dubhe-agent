// Verified through authenticated GET /v1/models and GET /v1/models/pricing, 2026-10-14.
// Whitelisted catalog + list-price fields only: no key, account discounts or private billing data.
// 'hot' is retained for sorting compatibility; the UI calls this app-curated 'Recommended', NOT popularity.
// Cheap: list input <= $1 AND output <= $5 per million tokens. New: newly included in our menu snapshot.
// Removed from active choices after user-confirmed retirement; historical billing stays readable.
export const RETIRED_MODEL_IDS = new Set(['kimi-k3', 'kimi-k3[1M]']);
export const isRetiredModel = id => RETIRED_MODEL_IDS.has(String(id || '').trim());
export const MODEL_CATALOG_DATE = '2026-10-14';
export const MODEL_CATALOG = [
  {"id":"claude-fable-5","provider":"Anthropic","displayName":"Claude Fable 5","channel":"chat","listPrice":{"currency":"USD","input":10.0,"output":50.0,"cached_input":1.0},"contextWindow":1000000},
  {"id":"claude-fable-5-1","provider":"Anthropic","displayName":"Claude Fable 5.1","channel":"chat","listPrice":{"currency":"USD","input":10.0,"output":50.0,"cached_input":0.25},"contextWindow":1000000},
  {"id":"claude-haiku-4-5","provider":"Anthropic","displayName":"Claude Haiku 4.5","channel":"chat","listPrice":{"currency":"USD","input":1.0,"output":5.0,"cached_input":0.1},"cheap":true,"contextWindow":200000},
  {"id":"claude-haiku-4-5-20251001","provider":"Anthropic","displayName":"Claude Haiku 4.5 (20251001)","channel":"chat","listPrice":{"currency":"USD","input":1.0,"output":5.0,"cached_input":0.1},"cheap":true},
  {"id":"claude-haiku-5-5","provider":"Anthropic","displayName":"Claude haiku 5.5","channel":"chat","hot":true,"newlyListed":true,"listPrice":{"currency":"USD","input":0.1,"output":0.5,"cached_input":0.01},"cheap":true,"contextWindow":1000000},
  {"id":"claude-opus-4-6","provider":"Anthropic","displayName":"Claude Opus 4.6","channel":"chat","listPrice":{"currency":"USD","input":5.0,"output":25.0,"cached_input":0.5},"contextWindow":1000000},
  {"id":"claude-opus-4-7","provider":"Anthropic","displayName":"Claude Opus 4.7","channel":"chat","listPrice":{"currency":"USD","input":5.0,"output":25.0,"cached_input":0.5},"contextWindow":1000000},
  {"id":"claude-opus-4-8","provider":"Anthropic","displayName":"Claude Opus 4.8","channel":"chat","listPrice":{"currency":"USD","input":5.0,"output":25.0,"cached_input":0.5},"contextWindow":1000000},
  {"id":"claude-opus-5","provider":"Anthropic","displayName":"Claude Opus 5","channel":"chat","listPrice":{"currency":"USD","input":5.0,"output":25.0,"cached_input":0.5},"contextWindow":1000000},
  {"id":"claude-opus-5-5","provider":"Anthropic","displayName":"Claude Opus 5.5","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":4.0,"output":20.0,"cached_input":0.2},"contextWindow":1000000},
  {"id":"claude-sonnet-4-6","provider":"Anthropic","displayName":"Claude Sonnet 4.6","channel":"chat","listPrice":{"currency":"USD","input":3.0,"output":15.0,"cached_input":0.3},"contextWindow":1000000},
  {"id":"claude-sonnet-5","provider":"Anthropic","displayName":"Claude Sonnet 5","channel":"chat","listPrice":{"currency":"USD","input":2.0,"output":10.0,"cached_input":0.2},"contextWindow":1000000},
  {"id":"claude-sonnet-5-5","provider":"Anthropic","displayName":"Claude sonnet 5.5","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":2.0,"output":10.0,"cached_input":0.2},"contextWindow":1000000},
  {"id":"deepseek-flash","provider":"DeepSeek","displayName":"DeepSeek V4.1 Flash","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":0.15,"output":0.6,"cached_input":0.003},"cheap":true,"contextWindow":1000000},
  {"id":"deepseek-flash-free","provider":"TeamoRouter","displayName":"DeepSeek V4.1 Flash福利版","channel":"chat","hidden":true,"listPrice":{"currency":"USD","input":0.15,"output":0.6,"cached_input":0.003},"cheap":true,"contextWindow":1000000},
  {"id":"deepseek-v4-flash","provider":"DeepSeek","displayName":"DeepSeek V4 Flash","channel":"chat","listPrice":{"currency":"USD","input":0.44,"output":1.32,"cached_input":0.014},"cheap":true,"contextWindow":1000000},
  {"id":"deepseek-v4-flash-free","provider":"TeamoRouter","displayName":"DeepSeek V4 Flash福利版","channel":"chat","hidden":true,"listPrice":{"currency":"USD","input":0.44,"output":1.32,"cached_input":0.014},"cheap":true,"contextWindow":1000000},
  {"id":"deepseek-v4-flash-vision-exp","provider":"DeepSeek","displayName":"DeepSeek V4 Flash Vision Exp","channel":"chat","listPrice":{"currency":"USD","input":0.22,"output":0.66,"cached_input":0.007},"cheap":true,"contextWindow":1000000},
  {"id":"deepseek-v4-pro","provider":"DeepSeek","displayName":"DeepSeek V4 Pro 正式版","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":0.66,"output":1.98,"cached_input":0.022},"cheap":true,"contextWindow":1000000},
  {"id":"deepseek-v4-pro-260425","provider":"DeepSeek","displayName":"DeepSeek V4 Pro 260425","channel":"chat","listPrice":{"currency":"USD","input":1.74,"output":3.48,"cached_input":0.145}},
  {"id":"gemini-3.1-flash-image","provider":"Google","displayName":"Gemini 3.1 Flash Image","channel":"image","listPrice":{"currency":"USD","input":0.5,"output":60.0}},
  {"id":"gemini-3.1-pro-preview","provider":"Google","displayName":"Gemini 3.1 Pro Preview","channel":"chat","listPrice":{"currency":"USD","input":2.0,"output":12.0,"cached_input":0.2},"contextWindow":2000000},
  {"id":"gemini-3.5-flash","provider":"Google","displayName":"Gemini 3.5 Flash","channel":"chat","listPrice":{"currency":"USD","input":1.5,"output":9.0,"cached_input":0.15},"contextWindow":1000000},
  {"id":"gemini-3.5-flash-lite","provider":"Google","displayName":"Gemini 3.5 Flash Lite","channel":"chat","listPrice":{"currency":"USD","input":0.3,"output":2.5,"cached_input":0.03},"cheap":true,"contextWindow":1000000},
  {"id":"gemini-3.6-flash","provider":"Google","displayName":"Gemini 3.6 Flash","channel":"chat","listPrice":{"currency":"USD","input":0.75,"output":3.75,"cached_input":0.075},"cheap":true,"contextWindow":1000000},
  {"id":"gemini-3.7-flash","provider":"Google","displayName":"Gemini 3.7 Flash","channel":"chat","listPrice":{"currency":"USD","input":0.75,"output":3.75,"cached_input":0.075},"cheap":true,"contextWindow":1000000},
  {"id":"gemini-3.8-flash","provider":"Google","displayName":"Gemini 3.8 Flash","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":0.75,"output":3.75,"cached_input":0.075},"cheap":true,"contextWindow":1000000},
  {"id":"gemini-4-argon","provider":"Google","displayName":"Gemini 4 Argon","channel":"chat","hot":true,"newlyListed":true,"listPrice":{"currency":"USD","input":2.0,"output":10.0,"cached_input":0.1},"contextWindow":1000000},
  {"id":"gemini-nano-banana-2.1","provider":"Google","displayName":"Nano Banana 2.1","channel":"image","listPrice":{"currency":"USD","input":1.5,"output":30.0}},
  {"id":"glm-5.2","provider":"GLM","displayName":"GLM-5.2","channel":"chat","listPrice":{"currency":"USD","input":1.4,"output":4.4,"cached_input":0.26},"contextWindow":1000000},
  {"id":"glm-5.3","provider":"GLM","displayName":"GLM-5.3","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":1.4,"output":4.4,"cached_input":0.26},"contextWindow":1000000},
  {"id":"glm-5.3-flash","provider":"GLM","displayName":"GLM-5.3-Flash (Ox Alpha)","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":0.114,"output":0.4,"cached_input":0.03},"cheap":true,"contextWindow":1000000},
  {"id":"glm-5.3-flash-free","provider":"TeamoRouter","displayName":"GLM 5.3 Flash福利版","channel":"chat","hidden":true,"listPrice":{"currency":"USD","input":0.114,"output":0.4,"cached_input":0.03},"cheap":true,"contextWindow":1000000},
  {"id":"gpt-5.4","provider":"OpenAI","displayName":"GPT-5.4","channel":"chat","listPrice":{"currency":"USD","input":2.5,"output":15.0,"cached_input":0.25},"contextWindow":1000000},
  {"id":"gpt-5.4-mini","provider":"OpenAI","displayName":"GPT-5.4-Mini","channel":"chat","listPrice":{"currency":"USD","input":0.75,"output":4.5,"cached_input":0.075},"cheap":true,"contextWindow":1000000},
  {"id":"gpt-5.5","provider":"OpenAI","displayName":"GPT-5.5","channel":"chat","listPrice":{"currency":"USD","input":5.0,"output":30.0,"cached_input":0.5},"contextWindow":1000000},
  {"id":"gpt-5.6-luna","provider":"OpenAI","displayName":"GPT-5.6 Luna","channel":"chat","listPrice":{"currency":"USD","input":0.2,"output":1.2,"cached_input":0.02},"cheap":true,"contextWindow":1000000},
  {"id":"gpt-5.6-sol","provider":"OpenAI","displayName":"GPT-5.6 Sol","channel":"chat","listPrice":{"currency":"USD","input":5.0,"output":30.0,"cached_input":0.5},"contextWindow":1000000},
  {"id":"gpt-5.6-terra","provider":"OpenAI","displayName":"GPT-5.6 Terra","channel":"chat","listPrice":{"currency":"USD","input":2.0,"output":12.0,"cached_input":0.2},"contextWindow":1000000},
  {"id":"gpt-6-astra","provider":"OpenAI","displayName":"GPT-6 Astra","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":10.0,"output":50.0,"cached_input":1.0},"contextWindow":1000000},
  {"id":"gpt-6-luna","provider":"OpenAI","displayName":"GPT-6 Luna","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":0.1,"output":0.5,"cached_input":0.01},"cheap":true,"contextWindow":1000000},
  {"id":"gpt-6-sol","provider":"OpenAI","displayName":"GPT-6 Sol","channel":"chat","listPrice":{"currency":"USD","input":2.0,"output":10.0,"cached_input":0.2},"contextWindow":1000000},
  {"id":"gpt-6.1-sol","provider":"OpenAI","displayName":"GPT 6.1 Sol","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":2.0,"output":10.0,"cached_input":0.1},"contextWindow":1000000},
  {"id":"gpt-image-2","provider":"OpenAI","displayName":"GPT Image 2","channel":"image","listPrice":{"currency":"USD","input":5.0,"output":30.0,"cached_input":1.25}},
  {"id":"gpt-image-2.5-flare","provider":"OpenAI","displayName":"GPT Image 2.5 Flare","channel":"image","listPrice":{"currency":"USD","input":5.0,"output":30.0,"cached_input":1.25}},
  {"id":"gpt-image-2.5-sunburst","provider":"OpenAI","displayName":"GPT Image 2.5 Sunburst","channel":"image","listPrice":{"currency":"USD","input":5.0,"output":30.0,"cached_input":1.25}},
  {"id":"grok-4.6","provider":"Grok","displayName":"Grok 4.6","channel":"chat","hot":true,"listPrice":{"currency":"USD","input":2.0,"output":6.0,"cached_input":0.5},"contextWindow":500000},
];
export const MODEL_CATALOG_BY_ID = new Map(MODEL_CATALOG.map(m => [m.id, m]));
// A successful live response is authoritative. Do not union unavailable fallback IDs back into it.
// A missing/failed response uses the checked-in snapshot, while an explicitly empty response stays empty.
export function mergeAvailableModels(liveIds, presets, liveKnown = Array.isArray(liveIds) && liveIds.length > 0) {
  const metadata = new Map(presets.map(m => [m.id, m]));
  const ids = liveKnown ? (liveIds || []) : presets.map(m => m.id);
  return [...new Set(['__smart_router__', ...ids.filter(id => typeof id === 'string' && id.trim() && !isRetiredModel(id))])]
    .map(id => ({ ...(metadata.get(id) || MODEL_CATALOG_BY_ID.get(id) || { id }) }));
}
