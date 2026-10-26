// Gateway registry for first-party and OpenAI-compatible endpoints.
// Default model IDs are curated fallback suggestions only; a successful live model-list
// response is authoritative. Provider keys are never retried against another gateway.
import { MODEL_CATALOG, isRetiredModel } from './model-catalog.js?v=2026.10.25.1';
import { text as localeText } from './locale.js';

export const DEFAULT_GATEWAY_ID = 'teamorouter';

// No-key fallbacks are a curated public-documentation list of text/chat model IDs,
// not an account-entitlement promise. Successful per-key model-list responses remain authoritative.
const suggestions = (provider, ids) => ids.map((id) => ({ id, provider, displayName: id }));
const FIRST_PARTY_MODELS = {
  anthropic: suggestions('Anthropic', [
    'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5',
  ]),
  openai: suggestions('OpenAI', [
    'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-6-sol',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini',
    'gpt-5.2', 'gpt-5.2-pro', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-pro', 'o3-pro', 'o3',
  ]),
  gemini: suggestions('Google', [
    'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview',
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  ]),
  // Current official GET /models inventory: the stable Flash alias and V4 Pro only.
  deepseek: [
    { id: 'deepseek-flash', provider: 'DeepSeek', displayName: 'DeepSeek V4.1 Flash' },
    { id: 'deepseek-v4-pro', provider: 'DeepSeek', displayName: 'DeepSeek V4 Pro' },
  ],
  glm: suggestions('GLM', [
    'glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo',
    'glm-4.7', 'glm-4.7-flashx', 'glm-4.7-flash', 'glm-4.6',
    'glm-4.5-air', 'glm-4.5-airx', 'glm-4.5-flash', 'glm-4-long',
    'glm-4-flashx-250414', 'glm-4-flash-250414',
  ]),
  grok: suggestions('Grok', ['grok-4.7', 'latest']),
  kimi: suggestions('Kimi', [
    'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6',
  ]),
  doubao: suggestions('Doubao', [
    'doubao-seed-evolving',
    'doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-turbo-260628',
    'doubao-seed-2-1-pro-260628', 'doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-mini-260428',
    'doubao-seed-character-260628', 'doubao-seed-character-251128', 'doubao-seed-translation-250915',
  ]),
  qwen: suggestions('Qwen', [
    'qwen3.8-max', 'qwen3.8-max-0902', 'qwen3.8-flash', 'qwen3.8-omni-flash',
    'qwen3.8-2.4t-a95b', 'qwen3.8-27b',
    'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.6-plus', 'qwen3.6-flash', 'qwen3.5-plus', 'qwen3.5-flash',
  ]),
  custom: [],
};

export const GATEWAYS = Object.freeze([
  {
    id: 'teamorouter', name: 'TeamoRouter', category: 'third-party', provider: null,
    baseUrl: null, protocol: 'auto', listMode: 'openai', listPath: '/v1/models',
    docsUrl: 'https://teamorouter.cn/zh/docs/api-integration', keyHint: 'sk-teamo-…',
    keyLabel: 'TeamoRouter API Key', supportsFastMode: true, supportsImageGeneration: true,
  },
  {
    id: 'anthropic', name: 'Claude / Anthropic', category: 'first-party', provider: 'Anthropic',
    baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', chatPath: 'v1/messages',
    listMode: 'anthropic', listPath: 'v1/models', docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    keyHint: 'sk-ant-…', keyLabel: 'Anthropic API Key',
  },
  {
    id: 'openai', name: 'GPT / OpenAI', category: 'first-party', provider: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1', protocol: 'openai', chatPath: 'chat/completions', responsesPath: 'responses',
    listMode: 'openai', listPath: 'models', docsUrl: 'https://platform.openai.com/docs/api-reference',
    keyHint: 'sk-…', keyLabel: 'OpenAI API Key', supportsImageGeneration: true,
  },
  {
    id: 'gemini', name: 'Gemini / Google AI', category: 'first-party', provider: 'Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', nativeBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'openai', chatPath: 'chat/completions', supportsImageGeneration: true,
    listMode: 'gemini', listBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', listPath: 'models',
    docsUrl: 'https://ai.google.dev/api', keyHint: 'AIza…', keyLabel: 'Google AI API Key',
  },
  {
    id: 'deepseek', name: 'DeepSeek', category: 'first-party', provider: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com', protocol: 'openai', chatPath: 'chat/completions', listMode: 'openai', listPath: 'models',
    docsUrl: 'https://api-docs.deepseek.com/', keyHint: 'sk-…', keyLabel: 'DeepSeek API Key',
  },
  {
    id: 'glm', name: 'GLM / 智谱 AI', category: 'first-party', provider: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai', chatPath: 'chat/completions', listMode: 'static',
    docsUrl: 'https://open.bigmodel.cn/dev/api', keyHint: 'id.secret', keyLabel: '智谱 API Key',
  },
  {
    id: 'grok', name: 'Grok / xAI', category: 'first-party', provider: 'Grok',
    baseUrl: 'https://api.x.ai/v1', protocol: 'openai', chatPath: 'chat/completions', listMode: 'openai', listPath: 'language-models',
    docsUrl: 'https://docs.x.ai/developers/rest-api-reference/inference/models', keyHint: 'xai-…', keyLabel: 'xAI API Key',
  },
  {
    id: 'kimi', name: 'Kimi / Moonshot AI', category: 'first-party', provider: 'Kimi',
    baseUrl: 'https://api.moonshot.ai/v1', protocol: 'openai', chatPath: 'chat/completions', listMode: 'openai', listPath: 'models',
    docsUrl: 'https://platform.kimi.ai/docs/api/overview', keyHint: 'sk-…', keyLabel: 'Kimi API Key',
  },
  {
    id: 'doubao', name: 'Doubao / 火山方舟', category: 'first-party', provider: 'Doubao',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'openai', chatPath: 'chat/completions', listMode: 'static',
    docsUrl: 'https://docs.volcengine.com/docs/ark/text-generation?lang=zh', keyHint: '火山方舟 API Key', keyLabel: '火山方舟 API Key',
  },
  {
    id: 'qwen', name: 'Qwen / 阿里云百炼', category: 'first-party', provider: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai', chatPath: 'chat/completions', listMode: 'qwen',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/models', keyHint: 'sk-…', keyLabel: '阿里云百炼 API Key',
  },
  {
    id: 'custom', name: '自定义 OpenAI 兼容网关', category: 'third-party', provider: null,
    baseUrl: '', protocol: 'openai', chatPath: 'chat/completions', listMode: 'openai', listPath: 'models',
    docsUrl: 'https://platform.openai.com/docs/api-reference', keyHint: '网关要求的 API Key', keyLabel: '自定义网关 API Key',
  },
]);

const BY_ID = new Map(GATEWAYS.map((g) => [g.id, g]));
export function getGateway(id = DEFAULT_GATEWAY_ID) { return BY_ID.get(String(id || '')) || BY_ID.get(DEFAULT_GATEWAY_ID); }
export function isGatewayId(id) { return BY_ID.has(String(id || '')); }
export function gatewayLabel(id) { return getGateway(id).name; }
export function gatewayBaseUrl(id, overrides = {}) {
  const spec = getGateway(id);
  const raw = overrides && typeof overrides === 'object' ? overrides[spec.id] : overrides;
  return String(raw || spec.baseUrl || '').trim().replace(/\/+$/, '');
}

export function gatewayNativeBaseUrl(id) {
  const spec = getGateway(id);
  return String(spec.nativeBaseUrl || '').trim().replace(/\/+$/, '');
}

export function gatewayPath(id, endpoint = 'chat') {
  const spec = getGateway(id);
  if (spec.id === DEFAULT_GATEWAY_ID) {
    if (endpoint === 'messages') return '/v1/messages';
    if (endpoint === 'responses') return '/v1/responses';
    if (endpoint === 'models') return '/v1/models';
    if (endpoint === 'images') return '/v1/images/generations';
    if (endpoint === 'imageEdit') return '/v1/images/edits';
    return '/v1/chat/completions';
  }
  if (endpoint === 'messages') return spec.chatPath || 'v1/messages';
  if (endpoint === 'responses') return spec.responsesPath || spec.chatPath || 'responses';
  if (endpoint === 'models') return spec.listPath || '';
  if (endpoint === 'images') return 'images/generations';
  if (endpoint === 'imageEdit') return 'images/edits';
  return spec.chatPath || 'chat/completions';
}

export function joinGatewayUrl(baseUrl, path) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const relative = String(path || '').trim().replace(/^\/+/, '');
  if (!base || !relative) throw new Error('Gateway URL is missing a base URL or endpoint path');
  let parsed;
  try { parsed = new URL(base); } catch { throw new Error('Gateway base URL is invalid'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Gateway base URL must be HTTPS and cannot contain credentials, a query, or a fragment');
  }
  return `${base}/${relative}`;
}

export function validateGatewayBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: true, value: '' };
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return { ok: false, reason: '仅允许 HTTPS 网关地址' };
    if (!url.hostname || url.username || url.password || url.search || url.hash) return { ok: false, reason: '地址不能含账号、密码、查询参数或片段' };
    return { ok: true, value: raw.replace(/\/+$/, '') };
  } catch { return { ok: false, reason: '请输入完整的 HTTPS URL，例如 https://api.example.com/v1' }; }
}

export function gatewayModelListUrl(id, baseUrl = '') {
  const spec = getGateway(id);
  if (spec.id === 'gemini') {
    const base = String(baseUrl || spec.listBaseUrl).trim().replace(/\/+$/, '');
    return `${joinGatewayUrl(base, spec.listPath)}?pageSize=1000`;
  }
  if (spec.id === 'qwen') {
    const chatBase = String(baseUrl || spec.baseUrl).trim();
    let origin = '';
    try { origin = new URL(chatBase).origin; } catch { throw new Error('Qwen 网关基础 URL 无效'); }
    // The official DashScope model directory pages at 100 items; derive the regional host
    // from the selected compatible-mode endpoint (WorkspaceId and API Key must share a region).
    return `${origin}/api/v1/models?providers=qwen&page_no=1&page_size=100`;
  }
  return joinGatewayUrl(baseUrl || spec.baseUrl, spec.listPath || 'models');
}

function providerFromModelId(modelId) {
  const m = String(modelId || '').toLowerCase();
  if (m.startsWith('claude')) return 'Anthropic';
  if (m.startsWith('gpt') || /^(o1|o3|o4|o[0-9]+)(?:-|$)/.test(m) || m.startsWith('chatgpt')) return 'OpenAI';
  if (m.startsWith('gemini')) return 'Google';
  if (m.startsWith('deepseek')) return 'DeepSeek';
  if (m.startsWith('glm')) return 'GLM';
  if (m.startsWith('grok') || m === 'latest') return 'Grok';
  if (m.startsWith('kimi') || m.startsWith('moonshot')) return 'Kimi';
  if (m.startsWith('doubao') || m.startsWith('seed-')) return 'Doubao';
  if (m.startsWith('qwen')) return 'Qwen';
  return '';
}

export function isModelForGateway(gatewayId, modelId, availableIds = null) {
  const spec = getGateway(gatewayId);
  const id = String(modelId || '').trim();
  if (!id || id === '__system__') return false;
  if (spec.id === DEFAULT_GATEWAY_ID || spec.id === 'custom') return id !== '__smart_router__' || spec.id === DEFAULT_GATEWAY_ID;
  if (id === '__smart_router__' || providerFromModelId(id) !== spec.provider) return false;
  // A successful provider listing is authoritative, even for a same-provider ID left by an old manual entry.
  if (Array.isArray(availableIds)) return availableIds.includes(id);
  return (FIRST_PARTY_MODELS[spec.id] || []).some((model) => model.id === id);
}

export function gatewayFallbackModels(gatewayId = DEFAULT_GATEWAY_ID) {
  const spec = getGateway(gatewayId);
  if (spec.id === DEFAULT_GATEWAY_ID) {
    return MODEL_CATALOG
      .filter((m) => m.channel === 'chat' && !m.hidden && !isRetiredModel(m.id, spec.id))
      .map((m) => ({ ...m }));
  }
  // First-party fallbacks are only the model IDs checked against that provider's own docs.
  // Never inherit TeamoRouter's directory snapshot (IDs, prices, or entitlements) for direct APIs.
  return (FIRST_PARTY_MODELS[spec.id] || []).map((model) => ({ ...model, channel: 'chat' }));
}

export function gatewayFallbackModelIds(gatewayId = DEFAULT_GATEWAY_ID) {
  if (getGateway(gatewayId).id === DEFAULT_GATEWAY_ID) return ['__smart_router__', ...gatewayFallbackModels(gatewayId).map((m) => m.id)];
  return gatewayFallbackModels(gatewayId).map((m) => m.id);
}

export function defaultModelForGateway(gatewayId = DEFAULT_GATEWAY_ID, preferred = '', availableIds = null) {
  const spec = getGateway(gatewayId);
  if (preferred && isModelForGateway(spec.id, preferred, availableIds) && preferred !== '__smart_router__') return preferred;
  if (spec.id === DEFAULT_GATEWAY_ID) return '__smart_router__';
  const defaults = {
    anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-flash', glm: 'glm-5.3-flash', grok: 'grok-4.7', kimi: 'kimi-k3',
    doubao: 'doubao-seed-2-1-lite-260915', qwen: 'qwen3.8-flash', custom: '',
  };
  const want = defaults[spec.id];
  if (Array.isArray(availableIds)) return availableIds.includes(want) ? want : (availableIds[0] || '');
  return gatewayFallbackModelIds(spec.id).includes(want) ? want : (gatewayFallbackModelIds(spec.id)[0] || '');
}

export function defaultVisionModelForGateway(gatewayId = DEFAULT_GATEWAY_ID) {
  const defaults = {
    teamorouter: 'deepseek-v4-flash-vision-exp', anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna',
    gemini: 'gemini-3.8-flash', deepseek: 'deepseek-flash', glm: 'glm-5.3', grok: 'grok-4.7',
    kimi: 'kimi-k3', doubao: 'doubao-seed-2-1-pro-260915', qwen: 'qwen3.8-omni-flash', custom: '',
  };
  return defaults[getGateway(gatewayId).id] || '';
}

export function isLikelyChatModel(id) {
  const m = String(id || '').trim().toLowerCase();
  if (!m || /(?:embedding|moderation|whisper|transcri|text-to-speech|\btts\b|image|dall-?e|imagen|seedream|video|realtime|audio|rerank|ocr|speech|veo|sora)/i.test(m)) return false;
  return true;
}

export function gatewayModelIdsFromResponse(gatewayId, json) {
  const spec = getGateway(gatewayId);
  if (spec.id === 'qwen') {
    const raw = json && json.output && json.output.models;
    return (Array.isArray(raw) ? raw : []).map((m) => typeof m === 'string' ? m : (m && (m.model || m.id))).filter(Boolean);
  }
  if (spec.id === 'gemini') {
    const raw = json && json.models;
    return (Array.isArray(raw) ? raw : [])
      .filter((m) => !Array.isArray(m.supportedActions) || m.supportedActions.includes('generateContent'))
      .map((m) => String(m.name || m.id || '').replace(/^models\//, '')).filter(Boolean);
  }
  if (spec.id === 'grok') {
    const raw = Array.isArray(json && json.models) ? json.models : (Array.isArray(json && json.data) ? json.data : []);
    return raw.filter((m) => !Array.isArray(m.input_modalities) || m.input_modalities.includes('text'))
      .map((m) => m && (m.id || m.name)).filter(Boolean);
  }
  const raw = Array.isArray(json && json.data) ? json.data : (Array.isArray(json && json.models) ? json.models : []);
  return raw.map((m) => m && (m.id || m.name || m)).filter(Boolean);
}

export function filterGatewayChatModels(gatewayId, ids) {
  const spec = getGateway(gatewayId);
  return [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter((id) => {
    if (!isLikelyChatModel(id)) return false;
    if (spec.id === DEFAULT_GATEWAY_ID || spec.id === 'custom' || spec.id === 'qwen') return true;
    if (spec.id === 'grok' && id === 'latest') return true;
    return providerFromModelId(id) === spec.provider;
  }))];
}

export function gatewayModelListLabel(gatewayId) {
  const spec = getGateway(gatewayId);
  if (spec.id === 'custom') return localeText('手动添加仅适用于自定义网关；已添加的模型可点 × 移除。上游是否支持以该网关返回为准。', 'Manual model IDs are only for the custom gateway. Click × to remove one; the upstream must still support it.');
  if (spec.id === 'qwen') return localeText('百炼 API Key 与网关 URL 必须属于同一地域；可在基础 URL 填入控制台提供的业务空间专属兼容端点。', 'The Model Studio API key and gateway URL must use the same region. You can enter the workspace-specific compatible endpoint from the console.');
  if (spec.listMode === 'static') return localeText('当前网关没有已核实的通用模型目录接口；此处仅列出官方文档中的文本模型 ID，账号权限和地域可能影响实际可用性。', 'No verified general model-list API is configured for this gateway. This is a documentation-based text-model list; account access and region may affect availability.');
  return localeText('模型列表仅用于发现可用 ID；新 Key 保存后会从当前网关直接刷新。', 'The model list discovers available IDs; after saving a key, refreshes query this gateway directly.');
}

export function validateGatewayApiKey(gatewayId, value) {
  const v = String(value || '').trim();
  if (!v) return { ok: true };
  const spec = getGateway(gatewayId);
  if (spec.id === DEFAULT_GATEWAY_ID) {
    if (!/^sk-teamo-[A-Za-z0-9_-]+$/.test(v)) return { ok: false, reason: 'TeamoRouter Key 应以 sk-teamo- 开头，只能包含字母/数字/_/-' };
    if (v.length < 25) return { ok: false, reason: 'Key 长度过短，请检查是否复制完整' };
    if (v.length > 200) return { ok: false, reason: 'Key 过长，请检查是否粘贴了多余字符' };
    return { ok: true };
  }
  if (/\s/.test(v)) return { ok: false, reason: 'API Key 不能包含空白字符' };
  if (v.length < 8) return { ok: false, reason: 'Key 长度过短，请检查是否复制完整' };
  if (v.length > 500) return { ok: false, reason: 'Key 过长，请检查是否粘贴了多余字符' };
  if (v.toLowerCase().startsWith('admin-')) return { ok: false, reason: '管理员别名只适用于 TeamoRouter；请粘贴此网关的原始 API Key' };
  return { ok: true };
}
