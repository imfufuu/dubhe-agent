// Gateway registry for first-party and OpenAI-compatible endpoints.
// Default model IDs are curated fallback suggestions only; a successful live model-list
// response is authoritative. Provider keys are never retried against another gateway.
import { MODEL_CATALOG, isRetiredModel } from './model-catalog.js?v=2026.10.11.1';

export const DEFAULT_GATEWAY_ID = 'teamorouter';

const FIRST_PARTY_MODELS = {
  anthropic: [
    { id: 'claude-haiku-5-5', provider: 'Anthropic', displayName: 'Claude Haiku 5.5' },
    { id: 'claude-sonnet-5-5', provider: 'Anthropic', displayName: 'Claude Sonnet 5.5' },
    { id: 'claude-opus-5-5', provider: 'Anthropic', displayName: 'Claude Opus 5.5' },
  ],
  openai: [],
  gemini: [
    { id: 'gemini-4-argon', provider: 'Google', displayName: 'Gemini 4 Argon' },
    { id: 'gemini-3.8-flash', provider: 'Google', displayName: 'Gemini 3.8 Flash' },
  ],
  // Current official GET /models inventory: the stable Flash alias and V4 Pro only.
  deepseek: [
    { id: 'deepseek-flash', provider: 'DeepSeek', displayName: 'DeepSeek V4.1 Flash' },
    { id: 'deepseek-v4-pro', provider: 'DeepSeek', displayName: 'DeepSeek V4 Pro' },
  ],
  glm: [],
  grok: [
    { id: 'grok-4.7', provider: 'Grok', displayName: 'Grok 4.7' },
    { id: 'latest', provider: 'Grok', displayName: 'latest' },
  ],
  kimi: [
    { id: 'kimi-k3', provider: 'Kimi', displayName: 'Kimi K3' },
    { id: 'kimi-k2.7-code', provider: 'Kimi', displayName: 'Kimi K2.7 Code' },
    { id: 'kimi-k2.7-code-highspeed', provider: 'Kimi', displayName: 'Kimi K2.7 Code Highspeed' },
    { id: 'kimi-k2.6', provider: 'Kimi', displayName: 'Kimi K2.6' },
  ],
  doubao: [
    { id: 'doubao-seed-2-1-pro-260915', provider: 'Doubao', displayName: 'Doubao Seed 2.1 Pro' },
    { id: 'doubao-seed-2-1-lite-260915', provider: 'Doubao', displayName: 'Doubao Seed 2.1 Lite' },
    { id: 'doubao-seed-2-1-turbo-260915', provider: 'Doubao', displayName: 'Doubao Seed 2.1 Turbo' },
    { id: 'doubao-seed-evolving', provider: 'Doubao', displayName: 'Doubao Seed Evolving' },
  ],
  qwen: [
    { id: 'qwen3.8-max', provider: 'Qwen', displayName: 'Qwen 3.8 Max' },
    { id: 'qwen3.8-flash', provider: 'Qwen', displayName: 'Qwen 3.8 Flash' },
    { id: 'qwen3.7-plus', provider: 'Qwen', displayName: 'Qwen 3.7 Plus' },
    { id: 'qwen3.8-omni-flash', provider: 'Qwen', displayName: 'Qwen 3.8 Omni Flash' },
  ],
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

export function isModelForGateway(gatewayId, modelId, manualIds = []) {
  const spec = getGateway(gatewayId);
  const id = String(modelId || '').trim();
  if (!id || id === '__system__') return false;
  if (spec.id === DEFAULT_GATEWAY_ID || spec.id === 'custom') return id !== '__smart_router__' || spec.id === DEFAULT_GATEWAY_ID;
  if (id === '__smart_router__') return false;
  if (Array.isArray(manualIds) && manualIds.includes(id)) return true;
  return providerFromModelId(id) === spec.provider;
}

export function gatewayFallbackModels(gatewayId = DEFAULT_GATEWAY_ID) {
  const spec = getGateway(gatewayId);
  if (spec.id === DEFAULT_GATEWAY_ID) {
    return MODEL_CATALOG
      .filter((m) => m.channel === 'chat' && !m.hidden && !isRetiredModel(m.id, spec.id))
      .map((m) => ({ ...m }));
  }
  const extra = FIRST_PARTY_MODELS[spec.id] || [];
  // DeepSeek's current first-party /models inventory is authoritative for fallback too:
  // do not surface TeamoRouter aliases or retired snapshot IDs when that endpoint is unavailable.
  const curatedIds = spec.id === 'deepseek' && extra.length ? new Set(extra.map((model) => model.id)) : null;
  const existing = MODEL_CATALOG.filter((m) => m.channel === 'chat' && m.provider === spec.provider && !m.hidden
    && (!curatedIds || curatedIds.has(m.id)));
  const merged = new Map();
  for (const model of [...existing, ...extra]) {
    if (spec.id === 'kimi' && isRetiredModel(model.id, DEFAULT_GATEWAY_ID)) {
      // Kimi IDs retired from the TeamoRouter directory may still be current on Moonshot.
    }
    merged.set(model.id, { ...(MODEL_CATALOG.find((m) => m.id === model.id) || {}), ...model, channel: 'chat' });
  }
  return [...merged.values()];
}

export function gatewayFallbackModelIds(gatewayId = DEFAULT_GATEWAY_ID) {
  if (getGateway(gatewayId).id === DEFAULT_GATEWAY_ID) return ['__smart_router__', ...gatewayFallbackModels(gatewayId).map((m) => m.id)];
  return gatewayFallbackModels(gatewayId).map((m) => m.id);
}

export function defaultModelForGateway(gatewayId = DEFAULT_GATEWAY_ID, preferred = '') {
  const spec = getGateway(gatewayId);
  const manualIds = [];
  if (preferred && isModelForGateway(spec.id, preferred, manualIds) && preferred !== '__smart_router__') return preferred;
  if (spec.id === DEFAULT_GATEWAY_ID) return '__smart_router__';
  const defaults = {
    anthropic: 'claude-haiku-5-5', openai: 'gpt-6-luna', gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-flash', glm: 'glm-5.3-flash', grok: 'grok-4.7', kimi: 'kimi-k3',
    doubao: 'doubao-seed-2-1-lite-260915', qwen: 'qwen3.8-flash', custom: '',
  };
  const want = defaults[spec.id];
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
  if (spec.id === 'qwen') return '百炼 API Key 与网关 URL 必须属于同一地域；可在基础 URL 填入控制台提供的业务空间专属兼容端点。';
  if (spec.listMode === 'static') return '该官方网关未提供已核实的通用模型目录接口；显示内置建议，具体可用性以控制台为准，可手动添加模型 ID。';
  return '模型列表仅用于发现可用 ID；新 Key 保存后会从当前网关直接刷新。';
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
