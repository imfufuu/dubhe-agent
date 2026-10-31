// ─── 模型公开标价与费用预估（USD 内部计价；界面按语言显示 USD / CNY）────────
// 2026-10-24 复核；国产模型优先使用供应商官方标准费率，其他条目沿用 TeamoRouter public list_cost。
// CNY 价目表按 2026-10-23 中间价归一为内部 USD；促销价、账户折扣和实际区域账单不计入。
// 分层价格在 contextTier 中显式建模；DeepSeek 当前 off-peak 值为预估基准，peak 时段会更高。
// 独立模块：不修改 config.js / api.js 的既有导出列表，避免 Pages 混版缓存下 ESM link 失败。
import { getLanguage } from './locale.js';
import {
  TEAMOROUTER_GATEWAY_ID, TEAMOROUTER_TEXT_PRICING, TEAMOROUTER_FAST_PRICING,
  TEAMOROUTER_GPT_IMAGE_PRICING, TEAMOROUTER_GEMINI_IMAGE_PRICING,
} from './teamorouter-pricing.js';
import { formatCurrency as formatCcy, formatRate, USD_TO_CNY_RATE } from './currency.js';
export { formatCcy, formatRate };
const cnyToUsd = (amountCny) => Number((Number(amountCny) / USD_TO_CNY_RATE).toFixed(9));

export const VISION_MODEL_ID = 'deepseek-v4-flash-vision-exp';

// 对话/推理模型公开费率估价基准（USD / 1M tokens）；供应商价与网关目录价以 model-catalog 的来源标签区分。
export const MODEL_PRICING = {
  'gemini-4-argon': { input: 2.0, output: 10.0, cachedInput: 0.1, cacheCreation: 2.0 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cachedInput: 0.01, cacheCreation: 0.125, cacheCreation1h: 0.2, contextTier: { thresholdTokens: 100000, inputMultiplier: 5, outputMultiplier: 5, cachedInputMultiplier: 5, cacheCreationMultiplier: 5, cacheCreation1hMultiplier: 5 } },
  // Anthropic Claude
  'claude-opus-5-5':          { input: 4.0,   output: 20.0,  cachedInput: 0.2,   cacheCreation: 5.0, cacheCreation1h: 8.0 },
  'claude-sonnet-5-5':        { input: 2.0,   output: 10.0,  cachedInput: 0.1,   cacheCreation: 2.5, cacheCreation1h: 4.0 },
  'claude-fable-5-1':         { input: 10.0,  output: 50.0,  cachedInput: 0.25,  cacheCreation: 12.5, cacheCreation1h: 20.0 },
  'claude-opus-5':            { input: 5.0,   output: 25.0,  cachedInput: 0.5,   cacheCreation: 6.25, cacheCreation1h: 10.0 },
  'claude-fable-5':           { input: 10.0,  output: 50.0,  cachedInput: 1.0,   cacheCreation: 12.5, cacheCreation1h: 20.0 },
  'claude-sonnet-5':          { input: 2.0,   output: 10.0,  cachedInput: 0.2,   cacheCreation: 2.5, cacheCreation1h: 4.0 },
  'claude-opus-4-8':          { input: 5.0,   output: 25.0,  cachedInput: 0.5,   cacheCreation: 6.25, cacheCreation1h: 10.0 },
  'claude-opus-4-7':          { input: 5.0,   output: 25.0,  cachedInput: 0.5,   cacheCreation: 6.25, cacheCreation1h: 10.0 },
  'claude-opus-4-6':          { input: 5.0,   output: 25.0,  cachedInput: 0.5,   cacheCreation: 6.25, cacheCreation1h: 10.0 },
  'claude-sonnet-4-6':        { input: 3.0,   output: 15.0,  cachedInput: 0.3,   cacheCreation: 3.75, cacheCreation1h: 6.0 },
  'claude-haiku-4-5':         { input: 1.0,   output: 5.0,   cachedInput: 0.1,   cacheCreation: 1.25, cacheCreation1h: 2.0 },
  'claude-haiku-4-5-20251001':{ input: 1.0,   output: 5.0,   cachedInput: 0.1,   cacheCreation: 1.25, cacheCreation1h: 2.0 },

  // OpenAI GPT（支持 Fast 模式 2x 官方价；272k 以上上下文阶梯计费）
  'gpt-6-astra':              { input: 10.0,  output: 50.0,  cachedInput: 1.0,   cacheCreation: 12.5,  fastMultiplier: 2.0, contextTier: true },
  'gpt-6.1-sol':              { input: 2.0,   output: 10.0,  cachedInput: 0.1,   cacheCreation: 2.5,   fastMultiplier: 2.0, contextTier: true },
  'gpt-6.1-terra':            { input: 0.171, output: 0.855, cachedInput: 0.00855 },
  'gpt-6-sol':                { input: 2.0,   output: 10.0,  cachedInput: 0.2,   cacheCreation: 2.5,   fastMultiplier: 2.0, contextTier: true },
  'gpt-6-luna':               { input: 0.1,   output: 0.5,   cachedInput: 0.01,  cacheCreation: 0.125, fastMultiplier: 2.0, contextTier: true },
  'gpt-5.6-sol':              { input: 5.0,   output: 30.0,  cachedInput: 0.5,   cacheCreation: 6.25,  fastMultiplier: 2.0, contextTier: true },
  'gpt-5.6-terra':            { input: 2.0,   output: 12.0,  cachedInput: 0.2,   cacheCreation: 2.5,   fastMultiplier: 2.0, contextTier: true },
  'gpt-5.6-luna':             { input: 0.2,   output: 1.2,   cachedInput: 0.02,  cacheCreation: 0.25,  fastMultiplier: 2.0, contextTier: true },
  'gpt-5.5':                  { input: 5.0,   output: 30.0,  cachedInput: 0.5,   fastMultiplier: 2.0,   contextTier: true },
  'gpt-5.4':                  { input: 2.5,   output: 15.0,  cachedInput: 0.25,  fastMultiplier: 2.0,   contextTier: true },
  'gpt-5.4-mini':             { input: 0.75,  output: 4.5,   cachedInput: 0.075, fastMultiplier: 2.0 },

  // Google Gemini
  'gemini-3.8-flash':         { input: 0.75,  output: 3.75,  cachedInput: 0.075 },
  'gemini-3.7-flash':         { input: 0.75,  output: 3.75,  cachedInput: 0.075 },
  'gemini-3.6-flash':         { input: 0.75,  output: 3.75,  cachedInput: 0.075 },
  'gemini-3.5-flash':         { input: 1.5,   output: 9.0,   cachedInput: 0.15 },
  'gemini-3.5-flash-lite':    { input: 0.3,   output: 2.5,   cachedInput: 0.03 },
  'gemini-3.1-pro-preview':   { input: 2.0,   output: 12.0,  cachedInput: 0.2 },

  // DeepSeek
  'deepseek-flash':           { input: 0.15,   output: 0.6,   cachedInput: 0.003 },
  'deepseek-flash-1017':      { input: 0.15,   output: 0.6,   cachedInput: 0.003 },
  'deepseek-v4-pro':          { input: 0.66,  output: 1.98,  cachedInput: 0.022 },
  'deepseek-v4-pro-260425':   { input: 0.66,  output: 1.98,  cachedInput: 0.022 },
  'deepseek-v4-flash':        { input: 0.15, output: 0.6,  cachedInput: 0.003 }, // legacy alias billed at V4.1 Flash off-peak rate

  // Zhipu GLM · BigModel standard CNY list prices normalized at the display FX rate.
  'glm-5.3':                  { input: cnyToUsd(8), output: cnyToUsd(28), cachedInput: cnyToUsd(2) },
  'glm-5.3-flash':            { input: cnyToUsd(0.8), output: cnyToUsd(2.8), cachedInput: cnyToUsd(0.23) },
  'glm-5.3-flash-free':       { input: cnyToUsd(0.8), output: cnyToUsd(2.8), cachedInput: cnyToUsd(0.23), freeTier: true },
  'glm-5.2':                  { input: cnyToUsd(8), output: cnyToUsd(28), cachedInput: cnyToUsd(2) },

  // Doubao / 火山引擎 · standard online (not low-priority) CNY list prices.
  'doubao-seed-2.0-lite':     { input: cnyToUsd(0.6), output: cnyToUsd(3.6), cachedInput: cnyToUsd(0.12),
    contextTier: { thresholdTokens: 32000, inputMultiplier: 1.5, outputMultiplier: 1.5, cachedInputMultiplier: 1.5,
      additionalTiers: [{ thresholdTokens: 128000, inputMultiplier: 3, outputMultiplier: 3, cachedInputMultiplier: 3 }] } },
  'doubao-seed-2.1-pro':      { input: cnyToUsd(6), output: cnyToUsd(30), cachedInput: cnyToUsd(1.2) },
  // 2026-10-31 TeamoRouter 实测报告（网关标价，USD / 1M tokens）
  'doubao-seed-2.1-lite':     { input: 0.11428571, output: 0.38571429, cachedInput: 0.02285714 },

  // Moonshot Kimi · official USD rates; cache writes billed separately at the same rate as input.
  'kimi-k3.1-pro':            { input: 2.0,   output: 10.0,  cachedInput: 0.2, cacheCreation: 2.0, cacheCreation1h: 4.0 },
  'kimi-k3':                  { input: 3.0,   output: 15.0,  cachedInput: 0.3, cacheCreation: 3.0, cacheCreation1h: 6.0 },
  'kimi-k3[1M]':              { input: 3.0,   output: 15.0,  cachedInput: 0.3, cacheCreation: 3.0, cacheCreation1h: 6.0 },

  // Xiaomi MiMo · official overseas real-time USD rates; TeamoRouter public pricing snapshot omitted these IDs.
  'mimo-v2.6-pro':            { input: 0.435, output: 0.87,  cachedInput: 0.0036 },
  'mimo-v2.6-flash':          { input: 0.14,  output: 0.28,  cachedInput: 0.0028 },

  // MiniMax · 512k 以上上下文输入/输出均按 2x 标价
  'minimax-m3.1-flash':       { input: 0.075, output: 0.3,   cachedInput: 0.0075 },
  'minimax-m3':               { input: 0.3,   output: 1.2,   cachedInput: 0.06, contextTier: { thresholdTokens: 512000, inputMultiplier: 2.0, outputMultiplier: 2.0, cachedInputMultiplier: 2.0 } },

  // Qwen / 通义千问 · official North China 2 standard CNY rates normalized at the display FX rate.
  'qwen3.8-max':              { input: cnyToUsd(12), output: cnyToUsd(36), cachedInput: cnyToUsd(1.5), cacheCreation: cnyToUsd(15) },
  'qwen3.8-flash':            { input: cnyToUsd(0.8), output: cnyToUsd(2.7), cachedInput: cnyToUsd(0.1), cacheCreation: cnyToUsd(1.25) },
  'qwen3.7-max':              { input: cnyToUsd(12), output: cnyToUsd(36), cachedInput: cnyToUsd(2.4), cacheCreation: cnyToUsd(15) },
  'qwen3.7-flash':            { input: cnyToUsd(0.2), output: cnyToUsd(0.8), cachedInput: cnyToUsd(0.04), cacheCreation: cnyToUsd(0.25),
    contextTier: { thresholdTokens: 32000, inputMultiplier: 3, outputMultiplier: 3, cachedInputMultiplier: 3,
      additionalTiers: [{ thresholdTokens: 256000, inputMultiplier: 6, outputMultiplier: 6, cachedInputMultiplier: 6 }] } },

  // xAI Grok
  'grok-4.6':                 { input: 2.0,   output: 6.0,   cachedInput: 0.5 },
  'grok-4.7':                 { input: 2.0,   output: 6.0,   cachedInput: 0.5 },

  // TypeSafe Jev（System One）
  'jev':                      { input: 0.042, output: 0.0 },
  'jev-1.14.0':               { input: 0.042, output: 0.0 },
  'jev-1.13.0':               { input: 0.042, output: 0.0 },
  'typesafe-ai/jev':          { input: 0.042, output: 0.0 },
};

// 识图模型专用官方价格表（USD / 1M tokens）
export const VISION_MODEL_PRICING = {
  'deepseek-v4-flash-vision-exp': {
    id: 'deepseek-v4-flash-vision-exp',
    label: 'DeepSeek V4 Flash Vision (legacy alias)',
    input: 0.15,
    output: 0.6,
    cachedInput: 0.003,
    defaultTokensPerImage: 1500,
  },
};

// 生图模型专用官方价格表（含按张阶梯官方价 per_call_tiers 与按 token 官方价）
export const IMAGE_MODEL_PRICING = {
  'gpt-image-2.5-sunburst': {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    mode: 'tier',
    input: 5.0,
    imageInput: 8.0,
    output: 30.0,
    cachedInput: 1.25,
    tiers: { '1k': 0.06, '2k': 0.20, '4k': 0.25 },
  },
  'gpt-image-2.5-flare': {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    mode: 'tier',
    input: 5.0,
    imageInput: 8.0,
    output: 30.0,
    cachedInput: 1.25,
    tiers: { '1k': 0.06, '2k': 0.20, '4k': 0.25 },
  },
  'gpt-image-2': {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    mode: 'tier',
    input: 5.0,
    imageInput: 8.0,
    output: 30.0,
    cachedInput: 1.25,
    tiers: { '1k': 0.06, '2k': 0.20, '4k': 0.25 },
  },
  // 4K 升采样变体：TeamoRouter 报告按张 $0.02（1K/2K/4K 同价），比原生 4K 便宜
  'gpt-image-2-4k-upscale': {
    id: 'gpt-image-2-4k-upscale',
    label: 'GPT Image 2 4K Upscale',
    mode: 'tier',
    input: 5.0,
    imageInput: 8.0,
    output: 30.0,
    cachedInput: 1.25,
    tiers: { '1k': 0.02, '2k': 0.02, '4k': 0.02 },
  },
  'gpt-image-2.5-sunburst-4k-upscale': {
    id: 'gpt-image-2.5-sunburst-4k-upscale',
    label: 'GPT Image 2.5 Sunburst 4K Upscale',
    mode: 'tier',
    input: 5.0,
    imageInput: 8.0,
    output: 30.0,
    cachedInput: 1.25,
    tiers: { '1k': 0.02, '2k': 0.02, '4k': 0.02 },
  },
  'gpt-image-2.5-flare-4k-upscale': {
    id: 'gpt-image-2.5-flare-4k-upscale',
    label: 'GPT Image 2.5 Flare 4K Upscale',
    mode: 'tier',
    input: 5.0,
    imageInput: 8.0,
    output: 30.0,
    cachedInput: 1.25,
    tiers: { '1k': 0.02, '2k': 0.02, '4k': 0.02 },
  },
  // Gemini 3 Pro Image：报告价 input $0.948 / 图像输出 $56.88 per 1M tokens；每张输出 token 数报告未给出，沿用 Flash 估算值 1290（仅为估算）
  'gemini-3-pro-image': {
    id: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    mode: 'token',
    input: 0.948,
    imageInput: 0.948,
    output: 56.88,
    defaultInputTokens: 64,
    defaultOutputTokensPerImage: 1290,
  },
  'gemini-3.1-flash-image': {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    mode: 'token',
    input: 0.5,
    imageInput: 0.5,
    output: 60.0,
    defaultInputTokens: 64,
    defaultOutputTokensPerImage: 1290, // 1290 * $60 / 1M ≈ $0.0774 / 张
  },
};

/** 归一化模型 ID（剥离 [1M] / (fast) 等后缀） */
export function normalizeModelKey(modelId) {
  const raw = String(modelId || '').trim().toLowerCase();
  const isFast = /\(fast\)/i.test(raw);
  const base = raw
    .replace(/\s*\(fast\)\s*$/i, '')
    .replace(/\[1m\]$/i, '')
    .trim();
  return { base, isFast };
}

export const PRICE_SOURCE_OFFICIAL = 'official';
export const PRICE_SOURCE_TEAMOROUTER = 'teamorouter';

export function isTeamoRouterGateway(gatewayId) {
  return String(gatewayId || '') === TEAMOROUTER_GATEWAY_ID;
}

/**
 * TeamoRouter 折后价覆盖（来源：实测报告）。返回合并后的价目对象；没有对应条目时返回 null，调用方沿用官方价。
 * 报告未列缓存写入价的文本模型，缓存写入按普通输入价计；报告未给出上下文分档，不套用官方长上下文加价。
 */
function teamorouterOverride(modelId, official) {
  const { base, isFast } = normalizeModelKey(modelId);
  if (!base) return null;
  if (isFast) {
    const f = TEAMOROUTER_FAST_PRICING[base];
    if (!f) return null;
    return {
      ...(official || {}), id: base, kind: 'chat', input: f.input, output: f.output,
      cachedInput: undefined, cacheCreation: undefined, cacheCreation1h: undefined,
      contextTier: null, fastMultiplier: 1, isFast: true, priceSource: PRICE_SOURCE_TEAMOROUTER,
    };
  }
  const tiers = TEAMOROUTER_GPT_IMAGE_PRICING[base];
  if (tiers) {
    return { ...(official || {}), id: base, label: base, kind: 'image', mode: 'tier', tiers: { ...tiers }, priceSource: PRICE_SOURCE_TEAMOROUTER };
  }
  const gem = TEAMOROUTER_GEMINI_IMAGE_PRICING[base];
  if (gem) {
    return {
      ...(official || {}), id: base, label: official?.label || base, kind: 'image', mode: 'token',
      input: gem.input, imageInput: gem.input, output: gem.output, priceSource: PRICE_SOURCE_TEAMOROUTER,
    };
  }
  const t = TEAMOROUTER_TEXT_PRICING[base];
  if (!t) return null;
  const isVision = official?.kind === 'vision' || base.includes('vision');
  return {
    ...(official || {}), id: base, kind: isVision ? 'vision' : 'chat',
    input: t.input, output: t.output, cachedInput: t.cachedInput,
    cacheCreation: t.input, cacheCreation1h: t.input,
    contextTier: null, fastMultiplier: 1, isFast: false,
    defaultTokensPerImage: official?.defaultTokensPerImage ?? 1500,
    priceSource: PRICE_SOURCE_TEAMOROUTER,
  };
}

/**
 * 查询模型费率估价配置。gatewayId 为 teamorouter 时优先使用报告折后价，否则（官方网关）使用官方报价。
 * 价格来源由返回对象的 priceSource 标明。
 */
export function getModelPricing(modelId, { gatewayId = '' } = {}) {
  const official = officialModelPricing(modelId);
  if (!isTeamoRouterGateway(gatewayId)) return official;
  const tr = teamorouterOverride(modelId, official);
  return tr || official;
}

/** 官方报价表查询（不区分网关） */
function officialModelPricing(modelId) {
  const { base, isFast } = normalizeModelKey(modelId);
  if (!base) return null;
  if (VISION_MODEL_PRICING[base]) return { ...VISION_MODEL_PRICING[base], kind: 'vision' };
  if (IMAGE_MODEL_PRICING[base]) return { ...IMAGE_MODEL_PRICING[base], kind: 'image' };
  if (MODEL_PRICING[base]) return { ...MODEL_PRICING[base], id: base, kind: 'chat', isFast };
  // 家族前缀兜底（未来新小版本上线时按同系官方基准价估算）
  if (base.startsWith('claude-opus-5-5')) return { input: 4.0, output: 20.0, cachedInput: 0.2, id: base, kind: 'chat' };
  if (base.startsWith('claude-fable')) return { input: 10.0, output: 50.0, cachedInput: 0.25, id: base, kind: 'chat' };
  if (base.startsWith('claude-opus')) return { input: 5.0, output: 25.0, cachedInput: 0.5, id: base, kind: 'chat' };
  if (base.startsWith('claude-sonnet-5')) return { input: 2.0, output: 10.0, cachedInput: 0.2, id: base, kind: 'chat' };
  if (base.startsWith('claude-sonnet')) return { input: 3.0, output: 15.0, cachedInput: 0.3, id: base, kind: 'chat' };
  if (base.startsWith('claude-haiku')) return { input: 1.0, output: 5.0, cachedInput: 0.1, id: base, kind: 'chat' };
  if (base.startsWith('gpt-6-astra')) return { input: 10.0, output: 50.0, cachedInput: 1.0, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-6-luna')) return { input: 0.1, output: 0.5, cachedInput: 0.01, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-6')) return { input: 2.0, output: 10.0, cachedInput: 0.2, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-5.6-sol') || base.startsWith('gpt-5.5')) return { input: 5.0, output: 30.0, cachedInput: 0.5, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-5.6-terra')) return { input: 2.0, output: 12.0, cachedInput: 0.2, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-5.6-luna')) return { input: 0.2, output: 1.2, cachedInput: 0.02, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-5.4-mini')) return { input: 0.75, output: 4.5, cachedInput: 0.075, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-5')) return { input: 2.5, output: 15.0, cachedInput: 0.25, fastMultiplier: 2.0, id: base, kind: 'chat', isFast };
  if (base.startsWith('gpt-image')) return { ...IMAGE_MODEL_PRICING['gpt-image-2.5-sunburst'], id: base, kind: 'image' };
  // Nano Banana 2.1：网关价目表 list $1.5 / $30 per 1M（TeamoRouter 折后 $0.435 / $8.7），token 计费，图像输出约 1120 tok/张（1K）
  if (/nano[-_]?banana[-_ ]?2[.-]1/.test(base)) return { ...IMAGE_MODEL_PRICING['gemini-3.1-flash-image'], id: base, kind: 'image', label: 'Nano Banana 2.1', input: 1.5, imageInput: 1.5, output: 30.0, defaultOutputTokensPerImage: 1120 };
  if (base.includes('flash-image') || /nano[-_]?banana/.test(base)) return { ...IMAGE_MODEL_PRICING['gemini-3.1-flash-image'], id: base, kind: 'image' };
  if (base.startsWith('gemini-3.1-pro')) return { input: 2.0, output: 12.0, cachedInput: 0.2, id: base, kind: 'chat' };
  if (base.startsWith('gemini-3.5-flash-lite')) return { input: 0.3, output: 2.5, cachedInput: 0.03, id: base, kind: 'chat' };
  if (base.startsWith('gemini-3.5-flash')) return { input: 1.5, output: 9.0, cachedInput: 0.15, id: base, kind: 'chat' };
  if (base.startsWith('gemini')) return { input: 0.75, output: 3.75, cachedInput: 0.075, id: base, kind: 'chat' };
  if (base.includes('vision')) return { ...VISION_MODEL_PRICING[VISION_MODEL_ID], id: base, kind: 'vision' };
  if (base.startsWith('deepseek-v4-pro')) return { input: 0.66, output: 1.98, cachedInput: 0.022, id: base, kind: 'chat' };
  if (base.startsWith('deepseek-v4-flash')) return { input: 0.15, output: 0.6, cachedInput: 0.003, id: base, kind: 'chat' };
  if (base.startsWith('deepseek')) return { input: 0.3, output: 1.2, cachedInput: 0.006, id: base, kind: 'chat' };
  if (base.startsWith('glm-5.3-flash')) return { input: cnyToUsd(0.8), output: cnyToUsd(2.8), cachedInput: cnyToUsd(0.23), id: base, kind: 'chat' };
  if (base.startsWith('glm')) return { input: 1.4, output: 4.4, cachedInput: 0.26, id: base, kind: 'chat' };
  if (base.startsWith('kimi')) return { input: 3.0, output: 15.0, cachedInput: 0.3, id: base, kind: 'chat' };
  if (base.startsWith('grok')) return { input: 2.0, output: 6.0, cachedInput: 0.5, id: base, kind: 'chat' };
  return null;
}

/** 计算单次对话/推理模型调用的公开费率估算费用（USD） */
export function estimateChatCost(modelId, usage, opts = {}) {
  const gatewayId = opts.gatewayId || '';
  const p = getModelPricing(modelId, { gatewayId });
  if (!p || !usage) return null;
  if (p.kind === 'vision') {
    return estimateVisionCost({
      model: modelId,
      inputTokens: Number(usage.input ?? usage.prompt_tokens ?? usage.input_tokens ?? 0),
      outputTokens: Number(usage.output ?? usage.completion_tokens ?? usage.output_tokens ?? 0),
      gatewayId,
    });
  }
  if (p.kind === 'image') {
    return estimateImageCost({ model: modelId, usage, gatewayId });
  }
  const inputTok = Math.max(0, Number(usage.input ?? usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0);
  const outputTok = Math.max(0, Number(usage.output ?? usage.completion_tokens ?? usage.output_tokens ?? 0) || 0);
  const cachedTok = Math.max(0, Number(usage.cached ?? usage.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0);
  const cacheCreation5mReported = Math.max(0, Number(usage.cacheCreation5m ?? usage.cache_creation_5m_input_tokens ?? 0) || 0);
  const cacheCreation1hReported = Math.max(0, Number(usage.cacheCreation1h ?? usage.cache_creation_1h_input_tokens ?? 0) || 0);
  const cacheCreationTotalReported = Math.max(0, Number(usage.cacheCreation ?? usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0) || 0);
  const splitCacheCreationTok = cacheCreation5mReported + cacheCreation1hReported;
  // Some protocols report only the TTL-specific split, others report only a combined write count.
  const cacheCreationTok = Math.max(cacheCreationTotalReported, splitCacheCreationTok);
  const cacheCreation5mTok = Math.min(cacheCreation5mReported, cacheCreationTok);
  const cacheCreation1hTok = Math.min(cacheCreation1hReported, Math.max(0, cacheCreationTok - cacheCreation5mTok));
  const cacheCreationUnspecifiedTok = Math.max(0, cacheCreationTok - cacheCreation5mTok - cacheCreation1hTok);
  const uncachedInput = Math.max(0, inputTok - cachedTok - cacheCreationTok);

  const fast = !!(opts.fastMode || p.isFast) && (p.fastMultiplier || 1) > 1;
  const fastMult = fast ? p.fastMultiplier : 1;
  const tier = p.contextTier && typeof p.contextTier === 'object'
    ? p.contextTier
    : { thresholdTokens: 272000, inputMultiplier: 2.0, outputMultiplier: 1.5, cachedInputMultiplier: 2.0 };
  let inputTier = 1, outputTier = 1, cachedTier = 1, cacheCreationTier = 1, cacheCreation1hTier = 1;
  if (p.contextTier && inputTok > tier.thresholdTokens) {
    inputTier = tier.inputMultiplier || 1;
    outputTier = tier.outputMultiplier || 1;
    cachedTier = tier.cachedInputMultiplier || inputTier;
    cacheCreationTier = tier.cacheCreationMultiplier || inputTier;
    cacheCreation1hTier = tier.cacheCreation1hMultiplier || cacheCreationTier;
    for (const next of tier.additionalTiers || []) {
      if (inputTok > next.thresholdTokens) {
        inputTier = next.inputMultiplier || inputTier;
        outputTier = next.outputMultiplier || outputTier;
        cachedTier = next.cachedInputMultiplier || inputTier;
        cacheCreationTier = next.cacheCreationMultiplier || inputTier;
        cacheCreation1hTier = next.cacheCreation1hMultiplier || cacheCreationTier;
      }
    }
  }
  const inRate = p.input * fastMult * inputTier;
  const outRate = p.output * fastMult * outputTier;
  const cachedRate = (p.cachedInput != null ? p.cachedInput : p.input * 0.1) * fastMult * cachedTier;
  const cacheCreation5mRate = (p.cacheCreation != null ? p.cacheCreation : p.input) * fastMult * cacheCreationTier;
  const cacheCreation1hRate = (p.cacheCreation1h != null ? p.cacheCreation1h : (p.cacheCreation != null ? p.cacheCreation : p.input)) * fastMult * cacheCreation1hTier;
  const cacheCreationRate = cacheCreation5mRate; // legacy summary field; aggregate-only usage defaults to 5m.
  const cacheStorageNote = String(p.id || modelId).startsWith('doubao-seed-')
    ? (getLanguage() === 'en'
      ? ' · Volcengine cache storage is billed per token-hour and is not included because storage-duration usage is unavailable'
      : ' · 火山引擎缓存存储按 token·小时计费；因未提供存储时长用量，未计入估价')
    : '';

  const costUsd = (
    uncachedInput * inRate + cachedTok * cachedRate
    + cacheCreation5mTok * cacheCreation5mRate
    + cacheCreation1hTok * cacheCreation1hRate
    + cacheCreationUnspecifiedTok * cacheCreation5mRate
    + outputTok * outRate
  ) / 1e6;
  return {
    kind: 'chat',
    model: p.id || String(modelId || ''),
    inputTokens: inputTok,
    outputTokens: outputTok,
    cachedTokens: cachedTok,
    cacheCreationTokens: cacheCreationTok,
    cacheCreation5mTokens: cacheCreation5mTok,
    cacheCreation1hTokens: cacheCreation1hTok,
    inRate,
    outRate,
    cachedRate,
    cacheCreationRate,
    cacheCreation5mRate,
    cacheCreation1hRate,
    fast,
    freeTier: !!p.freeTier,
    priceSource: p.priceSource || PRICE_SOURCE_OFFICIAL,
    costUsd,
    rateLabel: rateEstimateLabel('chat', inRate, outRate, `${fast ? (getLanguage() === 'en' ? ' (Fast 2×)' : '（Fast 2×）') : ''}${p.freeTier ? (getLanguage() === 'en' ? ' (gateway free tier)' : '（网关免费档）') : ''}${contextTierNote(p)}${cacheStorageNote}`),
  };
}

/** 单独处理：识图模型（deepseek-v4-flash-vision-exp）官方费用预估 */
export function estimateVisionCost({
  model = VISION_MODEL_ID,
  inputTokens = 0,
  outputTokens = 0,
  imageCount = 1,
  textChars = 0,
  inputUnavailable = false,
  gatewayId = '',
} = {}) {
  const { base } = normalizeModelKey(model);
  // 识图 / 视频识别模型可在设置里换成 Gemini / Claude：没有专表时用对话价目表（同一模型的多模态输入按文本 token 计）
  const officialP = VISION_MODEL_PRICING[base]
    || (MODEL_PRICING[base] ? { ...MODEL_PRICING[base], id: base, label: base, defaultTokensPerImage: 1100 } : VISION_MODEL_PRICING[VISION_MODEL_ID]);
  const p = (isTeamoRouterGateway(gatewayId) && teamorouterOverride(base, officialP)) || officialP;
  const imgs = Math.max(1, Number(imageCount) || 1);
  const hasExact = (Number(inputTokens) > 0) || (Number(outputTokens) > 0);
  const inTok = hasExact
    ? Math.max(0, Number(inputTokens) || 0)
    : imgs * (p.defaultTokensPerImage || 1500) + 120;
  const outTok = hasExact
    ? Math.max(0, Number(outputTokens) || 0)
    : Math.max(200, Math.ceil(Math.max(0, Number(textChars) || 0) * 0.85));
  const costUsd = (inTok * p.input + outTok * p.output) / 1e6;
  return {
    kind: 'vision',
    model: p.id,
    label: p.label,
    imageCount: imgs,
    inputTokens: inTok,
    outputTokens: outTok,
    estimated: !hasExact || inputUnavailable,
    inputUnavailable,
    inRate: p.input,
    outRate: p.output,
    costUsd,
    priceSource: p.priceSource || PRICE_SOURCE_OFFICIAL,
    rateLabel: rateEstimateLabel('vision', p.input, p.output),
  };
}

/** 解析生图尺寸/质量对应的官方阶梯档位（1k / 2k / 4k） */
export function resolveImageTier(size = 'auto', quality = 'auto') {
  const s = String(size || 'auto').toLowerCase();
  const q = String(quality || 'auto').toLowerCase();
  if (/4k|4096|2048x2048/.test(s)) return '4k';
  if (/2k|1536|1792/.test(s) || q === 'high') return '2k';
  return '1k';
}

/** 单独处理：生图/改图模型（GPT Image 系列 / Nano Banana 2）官方费用预估 */
export function estimateImageCost({
  model = 'gpt-image-2.5-sunburst',
  size = 'auto',
  quality = 'auto',
  count = 1,
  referenceCount = 0,
  usage = null,
  gatewayId = '',
} = {}) {
  const { base } = normalizeModelKey(model);
  const officialP = IMAGE_MODEL_PRICING[base] || getModelPricing(base) || IMAGE_MODEL_PRICING['gpt-image-2.5-sunburst'];
  const p = (isTeamoRouterGateway(gatewayId) && teamorouterOverride(base, officialP)) || officialP;
  const n = Math.max(1, Number(count) || 1);
  const refs = Math.max(0, Number(referenceCount) || 0);

  if (p.mode === 'token' || base.includes('gemini')) {
    const uIn = usage && (usage.input_tokens ?? usage.input ?? usage.prompt_tokens);
    const uOut = usage && (usage.output_tokens ?? usage.output ?? usage.completion_tokens);
    const inTok = uIn != null ? Math.max(0, Number(uIn)) : (p.defaultInputTokens || 64) + refs * 258;
    const outTok = uOut != null && Number(uOut) > 0
      ? Math.max(0, Number(uOut))
      : n * (p.defaultOutputTokensPerImage || 1290);
    const costUsd = (inTok * p.input + outTok * p.output) / 1e6;
    return {
      kind: 'image',
    priceSource: p.priceSource || PRICE_SOURCE_OFFICIAL,
      priceSource: p.priceSource || PRICE_SOURCE_OFFICIAL,
      model: p.id || base,
      label: p.label || base,
      mode: 'token',
      count: n,
      referenceCount: refs,
      inputTokens: inTok,
      outputTokens: outTok,
      inRate: p.input,
      outRate: p.output,
      costUsd,
      rateLabel: `${rateEstimateLabel('image', p.input, p.output)}${getLanguage() === 'en' ? ` (${n} images)` : `（${n} 张）`}`,
    };
  }

  // OpenAI GPT Image 系列：按官方 per_call_tiers（1K $0.06 / 2K $0.20 / 4K $0.25）或实测 token 计费
  const tier = resolveImageTier(size, quality);
  const tiers = p.tiers || { '1k': 0.06, '2k': 0.20, '4k': 0.25 };
  const perImage = tiers[tier] ?? tiers['1k'] ?? 0.06;
  const uIn = usage && (usage.input_tokens ?? usage.input ?? usage.prompt_tokens);
  const uOut = usage && (usage.output_tokens ?? usage.output ?? usage.completion_tokens);
  let costUsd;
  if (uIn != null || uOut != null) {
    const inTok = Math.max(0, Number(uIn) || 0);
    const outTok = Math.max(0, Number(uOut) || 0);
    const tokCost = (inTok * p.input + outTok * p.output) / 1e6;
    costUsd = outTok > 0 ? tokCost : (perImage * n + tokCost);
  } else {
    const refCost = refs > 0 ? (refs * 1500 * (p.imageInput || p.input)) / 1e6 : 0;
    costUsd = perImage * n + refCost;
  }
  return {
    kind: 'image',
    model: p.id || base,
    label: p.label || base,
    mode: 'tier',
    tier,
    perImage,
    count: n,
    referenceCount: refs,
    costUsd,
    rateLabel: getLanguage() === 'en'
      ? `Official image rate ${tier.toUpperCase()} ${formatCcy(perImage)}/image × ${n}${refs ? ` (plus ${refs} reference images)` : ''}`
      : `生图官方价 ${tier.toUpperCase()} ${formatCcy(perImage)}/张 × ${n} 张${refs ? `（含 ${refs} 张参考图输入）` : ''}`,
  };
}

/** 格式化美元金额，供 tok 信息旁展示 */
export function formatUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return '$0.0000';
  if (n === 0) return '$0.0000';
  if (n < 0.0001) return `<$0.0001`;
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00')}`;
  return `$${n.toFixed(2)}`;
}

function contextTierNote(p, language = getLanguage()) {
  const tier = p?.contextTier;
  if (!tier || typeof tier !== 'object' || !Number.isFinite(Number(tier.thresholdTokens))) return '';
  const additional = tier.additionalTiers || [];
  const thresholds = [tier.thresholdTokens, ...additional.map((x) => x.thresholdTokens)];
  const multipliers = [tier.inputMultiplier || 1, ...additional.map((x) => x.inputMultiplier || 1)];
  const parts = [`≤${Math.round(thresholds[0] / 1000)}K ×1`];
  for (let i = 0; i < thresholds.length; i++) {
    const mult = multipliers[i];
    if (mult === 1) continue;
    const start = Math.round(thresholds[i] / 1000);
    const end = thresholds[i + 1] == null ? null : Math.round(thresholds[i + 1] / 1000);
    parts.push(end == null ? `>${start}K ×${mult}` : `${start}K–${end}K ×${mult}`);
  }
  return language === 'en' ? ` (${parts.join('; ')})` : `（${parts.join('；')}）`;
}

function rateEstimateLabel(kind, input, output, extras = '', language = getLanguage()) {
  const name = language === 'en'
    ? ({ chat: 'Rate estimate', vision: 'Vision rate estimate', image: 'Image rate estimate' }[kind] || 'Rate estimate')
    : ({ chat: '费率估算', vision: '识图费率估算', image: '生图费率估算' }[kind] || '费率估算');
  return language === 'en'
    ? `${name}: input ${formatRate(input, language)}/M · output ${formatRate(output, language)}/M${extras}`
    : `${name} 输入 ${formatRate(input, language)}/M · 输出 ${formatRate(output, language)}/M${extras}`;
}

/** 生成用于模型选择器或提示条的简短价格标签 */
export function priceBadgeFor(modelId, { fastMode = false, language = getLanguage(), gatewayId = '' } = {}) {
  const p = getModelPricing(modelId, { gatewayId });
  if (!p) return '';
  if (p.kind === 'vision') return `${language === 'en' ? 'Vision' : '识图'} ${formatRate(p.input, language)}/${formatRate(p.output, language)} /M`;
  if (p.kind === 'image') {
    if (p.mode === 'tier' && p.tiers) return `${language === 'en' ? 'Image' : '生图'} ${formatCcy(p.tiers['1k'] || 0.06, language)}~${formatCcy(p.tiers['4k'] || 0.25, language)}/${language === 'en' ? 'image' : '张'}`;
    return `${language === 'en' ? 'Image' : '生图'} ${formatRate(p.input, language)}/${formatRate(p.output, language)} /M`;
  }
  const mult = (fastMode || p.isFast) && p.fastMultiplier ? p.fastMultiplier : 1;
  return `${formatRate(p.input * mult, language)}/${formatRate(p.output * mult, language)} /M${contextTierNote(p, language)}`;
}

/**
 * 汇总单轮（或单条消息）的官方预估价格：
 * - 对话/推理模型按 input/output tokens 计费
 * - 识图模型（deepseek-v4-flash-vision-exp）单独统计并单列展示
 * - 生图模型（GPT Image / Nano Banana 2）单独统计并单列展示
 * 支持两种调用签名：
 *   1) summarizeTurnCost(turnMessagesArray, { defaultModel, defaultImageModel, fastMode })
 *   2) summarizeTurnCost({ messages, model, fastMode, toolCosts, jevUsage })
 */
/** 本轮费用悬浮提示（tok-cost 的 title）：按网关区分口径 */
export function turnCostTitle(s) {
  return isTeamoRouterGateway(s.gatewayId)
    ? 'TeamoRouter 折后价预估（含识图/音视频分析/生图/视频生成/子智能体）'
    : '按模型官方列表价预估（含识图/音视频分析/生图/视频生成/子智能体）';
}

/** 本轮费用明细行（消息 meta 悬浮提示用） */
export function turnCostTipParts(s) {
  const parts = [`${isTeamoRouterGateway(s.gatewayId) ? 'TeamoRouter 折后' : '官方定价'}预估：${s.formatted}`];
  if (s.visionUsd > 0) parts.push(`含识图模型：${formatCcy(s.visionUsd)}`);
  if (s.avUsd > 0) parts.push(`含音视频分析：${formatCcy(s.avUsd)}`);
  if (s.imageUsd > 0) parts.push(`含生图模型：${formatCcy(s.imageUsd)}`);
  if (s.videoGenUsd > 0) parts.push(`含视频生成：${formatCcy(s.videoGenUsd)}`);
  if (s.subagentUsd > 0) parts.push(`含子智能体：${formatCcy(s.subagentUsd)}`);
  return parts;
}

/**
 * 视频生成计费：generate_video 提交前由 POST /v1/videos/quote 取得的美元报价（b.costUsd）。
 * 报价接口失败时 costUsd 为 null，本行记为未计价（不计入总价，界面注明）。
 */
function videoGenCost(b) {
  const hasQuote = b.costUsd != null && Number.isFinite(Number(b.costUsd));
  const costUsd = hasQuote ? Number(b.costUsd) : 0;
  return {
    kind: 'video_gen',
    model: b.model || 'video',
    seconds: Number(b.seconds) || 0,
    costUsd,
    estimated: !!b.estimated,
    unpriced: !hasQuote,
    priceSource: PRICE_SOURCE_TEAMOROUTER,
    rateLabel: hasQuote ? (getLanguage() === 'en' ? 'quoted by gateway' : '网关实时报价') : '',
  };
}

export function summarizeTurnCost(arg1, opts = {}) {
  const isConfigObj = arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) && !('role' in arg1);
  const list = isConfigObj
    ? (Array.isArray(arg1.messages) ? arg1.messages : [])
    : (Array.isArray(arg1) ? arg1 : (arg1 ? [arg1] : []));
  const defaultModel = (isConfigObj ? arg1.model : opts.defaultModel) || 'claude-sonnet-5';
  const defaultImageModel = (isConfigObj ? arg1.imageModel : opts.defaultImageModel) || 'gpt-image-2.5-sunburst';
  const fastMode = !!(isConfigObj ? arg1.fastMode : opts.fastMode);
  // 网关：每条 assistant 消息可带 gatewayId（发送时记录），缺省用回合级网关；官方网关为官方报价
  const turnGatewayId = String((isConfigObj ? arg1.gatewayId : opts.gatewayId) || '');
  const explicitToolCosts = isConfigObj && Array.isArray(arg1.toolCosts) ? arg1.toolCosts : [];
  const explicitJevUsage = isConfigObj ? arg1.jevUsage : opts.jevUsage;

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let cacheCreationTokens = 0;
  let cacheCreation5mTokens = 0;
  let cacheCreation1hTokens = 0;
  let reasoningTokens = 0;
  let hasChatUsage = false;
  let chatCostUsd = 0;
  let subagentCostUsd = 0;
  let jevCostUsd = 0;
  let visionCostUsd = 0;
  let imageCostUsd = 0;
  let avCostUsd = 0;
  let videoGenCostUsd = 0;
  const chatModels = new Set();
  const visionItems = [];
  const imageItems = [];
  const avItems = [];
  const videoGenItems = [];
  const countedToolCallIds = new Set();

  for (const b of explicitToolCosts) {
    if (!b || typeof b !== 'object') continue;
    if (b.id) countedToolCallIds.add(b.id);
    if (b.kind === 'vision') {
      const vc = estimateVisionCost({
        model: b.model || VISION_MODEL_ID,
        inputTokens: b.usage?.input ?? b.input ?? b.inputTokens ?? 0,
        outputTokens: b.usage?.output ?? b.output ?? b.outputTokens ?? 0,
        imageCount: b.imageCount || 1,
        textChars: b.textChars || 0,
        inputUnavailable: !!b.inputUnavailable,
        gatewayId: turnGatewayId,
      });
      if (b.media === 'video' || b.media === 'audio') {
        avCostUsd += vc.costUsd;
        avItems.push({ ...vc, media: b.media });
      } else {
        visionCostUsd += vc.costUsd;
        visionItems.push(vc);
      }
    } else if (b.kind === 'image_gen' || b.kind === 'image') {
      const ic = estimateImageCost({
        model: b.model || defaultImageModel,
        size: b.size || 'auto',
        quality: b.quality || 'auto',
        count: b.count || 1,
        referenceCount: b.referenceCount || 0,
        usage: (b.inputTokens || b.outputTokens) ? { input_tokens: b.inputTokens, output_tokens: b.outputTokens } : null,
        gatewayId: turnGatewayId,
      });
      imageCostUsd += ic.costUsd;
      imageItems.push(ic);
    } else if (b.kind === 'video_gen') {
      const vg = videoGenCost(b);
      videoGenCostUsd += vg.costUsd;
      videoGenItems.push(vg);
    }
  }

  const toolMsgById = new Map();
  for (const m of list) {
    if (m && m.role === 'tool' && m.toolCallId) toolMsgById.set(m.toolCallId, m);
  }

  for (const m of list) {
    if (!m || m.role !== 'assistant') continue;
    const model = m.model || defaultModel;
    if (model === '__system__' || model === 'Moderator') continue;
    const gw = String(m.gatewayId || turnGatewayId || '');
    if (m.usage && (m.usage.input != null || m.usage.output != null || m.usage.prompt_tokens != null || m.usage.completion_tokens != null)) {
      const c = estimateChatCost(model, m.usage, { fastMode: !!(m.fastMode ?? fastMode), gatewayId: gw });
      if (c) {
        hasChatUsage = true;
        inputTokens += c.inputTokens;
        outputTokens += c.outputTokens;
        cachedTokens += c.cachedTokens;
        cacheCreationTokens += c.cacheCreationTokens;
        cacheCreation5mTokens += c.cacheCreation5mTokens;
        cacheCreation1hTokens += c.cacheCreation1hTokens;
        if (m.usage.reasoning) reasoningTokens += Number(m.usage.reasoning) || 0;
        chatCostUsd += c.costUsd;
        chatModels.add(c.model);
      }
    }
    if (m.subagentUsage && (m.subagentUsage.input || m.subagentUsage.output)) {
      const sc = estimateChatCost(model, m.subagentUsage, { fastMode: !!(m.fastMode ?? fastMode), gatewayId: gw });
      if (sc) {
        hasChatUsage = true;
        inputTokens += sc.inputTokens;
        outputTokens += sc.outputTokens;
        cachedTokens += sc.cachedTokens;
        cacheCreationTokens += sc.cacheCreationTokens;
        cacheCreation5mTokens += sc.cacheCreation5mTokens;
        cacheCreation1hTokens += sc.cacheCreation1hTokens;
        subagentCostUsd += sc.costUsd;
      }
    }
    if (m.jevUsage && m.jevUsage.input) {
      const jc = estimateChatCost('jev', m.jevUsage, { gatewayId: gw });
      if (jc) jevCostUsd += jc.costUsd;
    }

    for (const tc of m.toolCalls || []) {
      if (!tc || (tc.id && countedToolCallIds.has(tc.id))) continue;
      const tm = toolMsgById.get(tc.id);
      const tContent = tm ? String(tm.content || '') : '';
      const b = tc.billing || tc.toolCost;
      if (b && b.kind === 'subagent') {
        const sc = estimateChatCost(b.model || defaultModel, b.usage || {}, { fastMode: !!(b.fastMode ?? m.fastMode ?? fastMode), gatewayId: gw });
        if (sc) {
          hasChatUsage = true;
          inputTokens += sc.inputTokens;
          outputTokens += sc.outputTokens;
          cachedTokens += sc.cachedTokens;
          cacheCreationTokens += sc.cacheCreationTokens;
          cacheCreation5mTokens += sc.cacheCreation5mTokens;
          cacheCreation1hTokens += sc.cacheCreation1hTokens;
          subagentCostUsd += sc.costUsd;
          chatModels.add(sc.model);
        }
        continue;
      }
      if (b && b.kind === 'vision') {
        const vc = b.costUsd != null ? b : estimateVisionCost({
          model: b.model || VISION_MODEL_ID,
          inputTokens: b.usage?.input ?? b.input ?? b.inputTokens ?? 0,
          outputTokens: b.usage?.output ?? b.output ?? b.outputTokens ?? 0,
          imageCount: b.imageCount || 1,
          textChars: b.textChars || 0,
          inputUnavailable: !!b.inputUnavailable,
          gatewayId: gw,
        });
        // 音视频分析（analyze_video / analyze_audio）单独成行，不计入识图
        if (b.media === 'video' || b.media === 'audio') {
          avCostUsd += Number(vc.costUsd) || 0;
          avItems.push({ ...vc, media: b.media });
        } else {
          visionCostUsd += Number(vc.costUsd) || 0;
          visionItems.push(vc);
        }
        continue;
      }
      if (b && b.kind === 'video_gen') {
        const vg = videoGenCost(b);
        videoGenCostUsd += vg.costUsd;
        videoGenItems.push(vg);
        continue;
      }
      if (b && (b.kind === 'image' || b.kind === 'image_gen')) {
        const ic = b.costUsd != null ? b : estimateImageCost({
          model: b.model || defaultImageModel,
          size: b.size || 'auto',
          quality: b.quality || 'auto',
          count: b.count || 1,
          referenceCount: b.referenceCount || 0,
          usage: (b.inputTokens || b.outputTokens) ? { input_tokens: b.inputTokens, output_tokens: b.outputTokens } : null,
          gatewayId: gw,
        });
        imageCostUsd += Number(ic.costUsd) || 0;
        imageItems.push(ic);
        continue;
      }
      if (tc.name === 'analyze_pdf' && (!tm || /^\[PDF 分析完成\]/.test(tContent))) {
        const shot = Number((/识图 (\d+) 页/.exec(tContent) || [])[1] || 0);
        if (!shot) continue;
        const vc = estimateVisionCost({ model: VISION_MODEL_ID, imageCount: shot, textChars: tContent.length || 600, gatewayId: gw });
        visionCostUsd += vc.costUsd;
        visionItems.push(vc);
        continue;
      }
      if (tc.name === 'analyze_video' && (!tm || /^\[视频识别完成\]/.test(tContent))) {
        // 没拿到 usage 时按「1 分钟视频 ≈ 4200 tok」保守估一段 1 分钟
        const mFound = /^\[视频识别完成\] 模型 (\S+)/.exec(tContent);
        const vc = estimateVisionCost({ model: mFound ? mFound[1] : 'gemini-3.8-flash', inputTokens: 4200, outputTokens: Math.max(200, Math.ceil((tContent.length || 600) * 0.85)), imageCount: 1, gatewayId: gw });
        avCostUsd += vc.costUsd;
        avItems.push({ ...vc, media: 'video' });
        continue;
      }
      if (tc.name === 'analyze_svg' && (!tm || /^\[SVG 识图完成\]/.test(tContent))) {
        if (tm && !/^\[SVG 识图完成\]/.test(tContent)) continue;
        const mFound = /^\[SVG 识图完成\] 模型 (\S+)/.exec(tContent);
        const vc = estimateVisionCost({ model: mFound ? mFound[1] : VISION_MODEL_ID, imageCount: 1, textChars: tContent.length || 600, gatewayId: gw });
        visionCostUsd += vc.costUsd;
        visionItems.push(vc);
        continue;
      }
      if (tc.name === 'analyze_image' && (!tm || /^\[识图完成\]/.test(tContent))) {
        const args = tc.args || {};
        const count = Array.isArray(args.paths) && args.paths.length ? args.paths.length : 1;
        const mFound = /^\[识图完成\] 模型 (\S+)/.exec(tContent);
        const vc = estimateVisionCost({
          model: mFound ? mFound[1] : VISION_MODEL_ID,
          imageCount: count,
          textChars: tContent.length || 600,
          gatewayId: gw,
        });
        visionCostUsd += vc.costUsd;
        visionItems.push(vc);
      } else if (tc.name === 'generate_image' && (!tm || /^\[图像(生成|编辑)完成\]/.test(tContent))) {
        const args = tc.args || {};
        if (Array.isArray(args.compare_paths) && args.compare_paths.length >= 2) continue;
        const modelMatch = /^- 模型：(\S+)/m.exec(tContent);
        const tokMatch = /计费\s*(\d+)\s*输入\s*\/\s*(\d+)\s*输出\s*tokens/.exec(tContent);
        const imgModel = (modelMatch && modelMatch[1]) || m.imageModel || defaultImageModel;
        const refs = Array.isArray(args.reference_paths) ? args.reference_paths.length : 0;
        const n = [1, 2, 3, 4].includes(Number(args.n)) ? Number(args.n) : 1;
        const ic = estimateImageCost({
          model: imgModel,
          size: args.size || 'auto',
          quality: args.quality || 'auto',
          count: n,
          referenceCount: refs,
          usage: tokMatch ? { input_tokens: Number(tokMatch[1]), output_tokens: Number(tokMatch[2]) } : null,
          gatewayId: gw,
        });
        imageCostUsd += ic.costUsd;
        imageItems.push(ic);
      }
    }
  }

  if (explicitJevUsage && explicitJevUsage.input && jevCostUsd === 0) {
    const jc = estimateChatCost('jev', explicitJevUsage, { gatewayId: turnGatewayId });
    if (jc) jevCostUsd += jc.costUsd;
  }

  const incomplete = visionItems.some(v => v.inputUnavailable);
  const totalCostUsd = chatCostUsd + subagentCostUsd + jevCostUsd + visionCostUsd + imageCostUsd + avCostUsd + videoGenCostUsd;
  const hasAny = hasChatUsage || visionItems.length > 0 || imageItems.length > 0 || avItems.length > 0 || videoGenItems.length > 0 || jevCostUsd > 0;
  if (!hasAny && !isConfigObj) return null;

  const trTurn = isTeamoRouterGateway(turnGatewayId);
  const extraTags = [];
  if (visionItems.length) extraTags.push(`识图 ${formatCcy(visionCostUsd)}`);
  if (avItems.length) extraTags.push(`音视频分析 ${formatCcy(avCostUsd)}`);
  if (imageItems.length) extraTags.push(`生图 ${formatCcy(imageCostUsd)}`);
  if (videoGenItems.length) extraTags.push(`视频生成 ${formatCcy(videoGenCostUsd)}`);
  const badgeText = extraTags.length
    ? `≈ ${formatCcy(totalCostUsd)}（${extraTags.join(' + ')}）`
    : `≈ ${formatCcy(totalCostUsd)}`;

  const tooltipLines = [trTurn
    ? `本轮 TeamoRouter 折后预估总价：${formatCcy(totalCostUsd)}`
    : `本轮官方预估总价：${formatCcy(totalCostUsd)}`];
  if (incomplete) tooltipLines.push('音频输入用量未完整回传，以上费用不完整；以网关账单为准。');
  if (hasChatUsage) {
    const mName = [...chatModels].join(', ') || defaultModel;
    const p = estimateChatCost(mName, { input: inputTokens, output: outputTokens }, { fastMode });
    tooltipLines.push(`· 对话模型（${mName}）：${formatCcy(chatCostUsd + subagentCostUsd)}（↑${inputTokens} ↓${outputTokens} tok${p ? ` · ${p.rateLabel}` : ''}）`);
  }
  if (visionItems.length) {
    const imgs = visionItems.reduce((s, x) => s + (Number(x.imageCount) || 1), 0);
    const vModels = [...new Set(visionItems.map((x) => x.model || VISION_MODEL_ID))].join(' / ');
    tooltipLines.push(`· 识图/视频/音频模型（${vModels}）：${formatCcy(visionCostUsd)}（共 ${imgs} 项 · ${visionItems[0].rateLabel || rateEstimateLabel('vision', 0.44, 1.32)}）`);
  }
  if (avItems.length) {
    const avModels = [...new Set(avItems.map((x) => x.model || VISION_MODEL_ID))].join(' / ');
    tooltipLines.push(`· 音视频分析模型（${avModels}）：${formatCcy(avCostUsd)}（共 ${avItems.length} 项 · ${avItems[0].rateLabel || ''}）`);
  }
  if (imageItems.length) {
    const imgs = imageItems.reduce((s, x) => s + (Number(x.count) || 1), 0);
    const imgModel = imageItems[0].model || defaultImageModel;
    tooltipLines.push(`· 生图模型（${imgModel}）：${formatCcy(imageCostUsd)}（共 ${imgs} 张 · ${imageItems[0].rateLabel || ''}）`);
  }
  if (videoGenItems.length) {
    const vModels = [...new Set(videoGenItems.map((x) => x.model))].join(' / ');
    const anyEstimated = videoGenItems.some((x) => x.estimated);
    const anyUnpriced = videoGenItems.some((x) => x.unpriced);
    tooltipLines.push(`· 视频生成模型（${vModels}）：${formatCcy(videoGenCostUsd)}（共 ${videoGenItems.length} 条 · ${trTurn ? 'POST /v1/videos/quote 实时报价' : '官方报价'}${anyEstimated ? ' · 预估' : ''}${anyUnpriced ? ' · 部分未取得报价' : ''}）`);
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    cacheCreationTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    reasoningTokens,
    chatCostUsd,
    chatUsd: chatCostUsd,
    subagentCostUsd,
    subagentUsd: subagentCostUsd,
    jevCostUsd,
    jevUsd: jevCostUsd,
    visionCostUsd,
    visionUsd: visionCostUsd,
    avCostUsd,
    avUsd: avCostUsd,
    imageCostUsd,
    imageUsd: imageCostUsd,
    videoGenCostUsd,
    videoGenUsd: videoGenCostUsd,
    gatewayId: turnGatewayId,
    totalCostUsd,
    totalUsd: totalCostUsd,
    incomplete,
    formatted: incomplete ? '用量不完整' : formatCcy(totalCostUsd),
    visionCount: visionItems.length,
    avCount: avItems.length,
    videoGenCount: videoGenItems.length,
    imageCount: imageItems.length,
    badgeText,
    tooltip: tooltipLines.join('\n'),
  };
}

