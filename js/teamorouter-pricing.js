// TeamoRouter 网关折后价（USD / 1M tokens；图像为每张）。数据来源：TeamoRouter 实测报告（2026-10-31）。
// 仅在网关为 TeamoRouter 时生效；官方网关仍使用 pricing.js 中的官方报价。
// 报告未列缓存写入价的模型，缓存写入按普通输入价计（见 pricing.js 中的 teamorouterRate）。

export const TEAMOROUTER_GATEWAY_ID = 'teamorouter';

/** 文本 / 多模态理解 / 决策模型（含 Jev）：input、output、cachedInput */
export const TEAMOROUTER_TEXT_PRICING = Object.freeze({
  'claude-opus-5-5': { input: 1.144, output: 5.72, cachedInput: 0.0572 },
  'claude-sonnet-5-5': { input: 0.572, output: 2.86, cachedInput: 0.0286 },
  'claude-haiku-5-5': { input: 0.0286, output: 0.143, cachedInput: 0.00286 },
  'claude-fable-5-1': { input: 3.0, output: 15.0, cachedInput: 0.075 },
  'claude-fable-5': { input: 3.0, output: 15.0, cachedInput: 0.3 },
  'claude-opus-5': { input: 1.43, output: 7.15, cachedInput: 0.143 },
  'claude-sonnet-5': { input: 0.572, output: 2.86, cachedInput: 0.0572 },
  'claude-opus-4-8': { input: 1.43, output: 7.15, cachedInput: 0.143 },
  'claude-opus-4-7': { input: 1.43, output: 7.15, cachedInput: 0.143 },
  'claude-opus-4-6': { input: 1.43, output: 7.15, cachedInput: 0.143 },
  'claude-sonnet-4-6': { input: 0.858, output: 4.29, cachedInput: 0.0858 },
  'claude-haiku-4-5': { input: 0.198, output: 0.99, cachedInput: 0.0198 },
  'claude-haiku-4-5-20251001': { input: 0.289, output: 1.445, cachedInput: 0.0289 },
  'gpt-6.1-sol': { input: 0.428, output: 2.14, cachedInput: 0.0214 },
  'gpt-6.1-terra': { input: 0.171, output: 0.855, cachedInput: 0.00855 },
  'gpt-6-astra': { input: 2.16, output: 10.8, cachedInput: 0.216 },
  'gpt-6-sol': { input: 0.428, output: 2.14, cachedInput: 0.0428 },
  'gpt-6-luna': { input: 0.05, output: 0.25, cachedInput: 0.005 },
  'gpt-5.6-sol': { input: 1.07, output: 6.42, cachedInput: 0.107 },
  'gpt-5.6-terra': { input: 0.342, output: 2.052, cachedInput: 0.0342 },
  'gpt-5.6-luna': { input: 0.1, output: 0.6, cachedInput: 0.01 },
  'gpt-5.5': { input: 2.525, output: 15.15, cachedInput: 0.2525 },
  'gpt-5.4': { input: 1.25, output: 7.5, cachedInput: 0.125 },
  'gpt-5.4-mini': { input: 0.375, output: 2.25, cachedInput: 0.0375 },
  'gemini-4-argon': { input: 0.58, output: 2.9, cachedInput: 0.029 },
  'gemini-3.8-flash': { input: 0.2175, output: 1.0875, cachedInput: 0.02175 },
  'gemini-3.7-flash': { input: 0.2175, output: 1.0875, cachedInput: 0.02175 },
  'gemini-3.6-flash': { input: 0.21825, output: 1.09125, cachedInput: 0.021825 },
  'gemini-3.5-flash': { input: 0.4605, output: 2.763, cachedInput: 0.04605 },
  'gemini-3.5-flash-lite': { input: 0.087, output: 0.725, cachedInput: 0.0087 },
  'gemini-3.1-pro-preview': { input: 0.904, output: 5.424, cachedInput: 0.0904 },
  'deepseek-flash': { input: 0.1275, output: 0.51, cachedInput: 0.00255 },
  'deepseek-flash-1017': { input: 0.1275, output: 0.51, cachedInput: 0.00255 },
  'deepseek-flash-free': { input: 0.00015, output: 0.0006, cachedInput: 3e-06 },
  'deepseek-v4-pro': { input: 0.561, output: 1.683, cachedInput: 0.0187 },
  'deepseek-v4-pro-260425': { input: 1.479, output: 2.958, cachedInput: 0.12325 },
  'deepseek-v4-flash': { input: 0.374, output: 1.122, cachedInput: 0.0119 },
  'deepseek-v4-flash-free': { input: 0.00044, output: 0.00132, cachedInput: 1.4e-05 },
  'deepseek-v4-flash-vision-exp': { input: 0.22, output: 0.66, cachedInput: 0.007 },
  'glm-5.3': { input: 0.7, output: 2.2, cachedInput: 0.13 },
  'glm-5.2': { input: 0.7, output: 2.2, cachedInput: 0.13 },
  'glm-5.3-flash': { input: 0.05814, output: 0.204, cachedInput: 0.0153 },
  'glm-5.3-flash-free': { input: 0.000114, output: 0.0004, cachedInput: 3e-05 },
  'qwen3.8-max': { input: 0.9137219, output: 2.7411657, cachedInput: 0.1142219 },
  'qwen3.8-flash': { input: 0.0688086, output: 0.2321914, cachedInput: 0.0086086 },
  'qwen3.7-max': { input: 0.85715, output: 2.57145, cachedInput: 0.17145 },
  'qwen3.7-flash': { input: 0.0286, output: 0.1143, cachedInput: 0.0057 },
  'doubao-seed-2.1-pro': { input: 0.8571, output: 4.2857, cachedInput: 0.1714 },
  'doubao-seed-2.1-lite': { input: 0.11428571, output: 0.38571429, cachedInput: 0.02285714 },
  'doubao-seed-2.0-lite': { input: 0.0857, output: 0.5143, cachedInput: 0.0171 },
  'kimi-k3.1-pro': { input: 1.816, output: 9.08, cachedInput: 0.1816 },
  'kimi-k3': { input: 1.578, output: 7.89, cachedInput: 0.1578 },
  'grok-4.7': { input: 0.24, output: 0.72, cachedInput: 0.06 },
  'grok-4.6': { input: 0.2, output: 0.6, cachedInput: 0.05 },
  'MiniMax-M3': { input: 0.3, output: 1.2, cachedInput: 0.06 },
  'minimax-m3.1-flash': { input: 0.075, output: 0.3, cachedInput: 0.0075 },
  'jev-1.14.0': { input: 0.042, output: 0.0 },
  'jev-1.13.0': { input: 0.042, output: 0.0 },
});

/** GPT Fast 加速档（请求体 service_tier: "fast"，基础模型 ID 不变） */
export const TEAMOROUTER_FAST_PRICING = Object.freeze({
  'gpt-6-astra': { input: 4.26, output: 21.3 },
  'gpt-5.6-sol': { input: 0.8, output: 4.8 },
  'gpt-5.6-terra': { input: 0.68, output: 4.08 },
});

/** GPT Image 按张阶梯价（1K / 2K / 4K）；4K 升采样变体 1K–4K 统一 $0.02 */
export const TEAMOROUTER_GPT_IMAGE_PRICING = Object.freeze({
  'gpt-image-2.5-sunburst': { '1k': 0.02, '2k': 0.0208, '4k': 0.0714 },
  'gpt-image-2.5-sunburst-4k-upscale': { '1k': 0.02, '2k': 0.02, '4k': 0.02 },
  'gpt-image-2.5-flare': { '1k': 0.02, '2k': 0.02, '4k': 0.0572 },
  'gpt-image-2.5-flare-4k-upscale': { '1k': 0.02, '2k': 0.02, '4k': 0.02 },
  'gpt-image-2': { '1k': 0.02, '2k': 0.02, '4k': 0.0858 },
  'gpt-image-2-4k-upscale': { '1k': 0.02, '2k': 0.02, '4k': 0.02 },
});

/** Gemini 原生生图按 Token：input（文本/图像输入）与 output（图像输出） */
export const TEAMOROUTER_GEMINI_IMAGE_PRICING = Object.freeze({
  'gemini-3-pro-image': { input: 0.948, output: 56.88 },
  'gemini-3.1-flash-image': { input: 0.2165, output: 25.98 },
  'gemini-nano-banana-2.1': { input: 0.75, output: 15.0 },
});

/** 视频：报告为按 Token（Seedance）或按秒（MiniMax）计价，不做静态估价；以 POST /v1/videos/quote 实时报价为准。 */
