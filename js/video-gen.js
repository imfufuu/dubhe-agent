// 视频生成（TeamoRouter /v1/videos）：模型目录、参数校验、请求体构造、轮询判定。
// 纯函数，不发请求；网络调用在 api.js（createVideoJob / getVideoJob / fetchVideoContent）。
// 依据：https://teamorouter.cn/zh/docs/video-generation-api（2026-10 文档）。
// 注意：文档只给了参数规格，沙箱无法访问网关，未做过真实生成测试。

export const VIDEO_GEN_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

// 分辨率档位 → 短边像素（size = WIDTHxHEIGHT 由短边与比例推出）
const SHORT_SIDE = { '480p': 480, '720p': 720, '768p': 768, '1080p': 1080, '2k': 1440, '4k': 2160 };

// 六个模型族，每族三个变体：文生视频 / 图生视频 / 参考图生视频
const FAMILIES = [
  { family: 'Seedance 2.5', ids: ['seedance-2-5-text-to-video-basic', 'seedance-2-5-image-to-video-basic', 'seedance-2-5-reference-to-video-basic'], seconds: [4, 30], resolutions: ['480p', '720p', '1080p'], tag: 'Seedance 2.5 · 最新', tagEn: 'Seedance 2.5 · newest', note: '4–30 秒 · 480p/720p/1080p', noteEn: '4–30 s · 480p/720p/1080p' },
  { family: 'Seedance 2.0', ids: ['seedance-2-0-text-to-video-basic', 'seedance-2-0-image-to-video-basic', 'seedance-2-0-reference-to-video-basic'], seconds: [4, 15], resolutions: ['480p', '720p', '1080p', '4k'], tag: 'Seedance 2.0 · 高质', tagEn: 'Seedance 2.0 · high quality', note: '4–15 秒 · 最高 4K', noteEn: '4–15 s · up to 4K' },
  { family: 'Seedance 2.0 Fast', ids: ['seedance-2-0-fast-text-to-video-basic', 'seedance-2-0-fast-image-to-video-basic', 'seedance-2-0-fast-reference-to-video-basic'], seconds: [4, 15], resolutions: ['480p', '720p'], tag: 'Seedance 2.0 · 快速', tagEn: 'Seedance 2.0 · fast', note: '4–15 秒 · 480p/720p', noteEn: '4–15 s · 480p/720p' },
  { family: 'Seedance 2.0 Mini', ids: ['seedance-2-0-mini-text-to-video-basic', 'seedance-2-0-mini-image-to-video-basic', 'seedance-2-0-mini-reference-to-video-basic'], seconds: [4, 15], resolutions: ['480p', '720p'], tag: 'Seedance 2.0 · 低价', tagEn: 'Seedance 2.0 · cheap', note: '4–15 秒 · 480p/720p', noteEn: '4–15 s · 480p/720p' },
  { family: 'MiniMax H3 Max', ids: ['minimax-h3-max-text-to-video', 'minimax-h3-max-image-to-video', 'minimax-h3-max-reference-to-video'], seconds: [4, 15], resolutions: ['768p'], tag: 'MiniMax H3 Max', tagEn: 'MiniMax H3 Max', note: '4–15 秒 · 768p', noteEn: '4–15 s · 768p' },
  { family: 'MiniMax H3', ids: ['minimax-h3-text-to-video', 'minimax-h3-image-to-video', 'minimax-h3-reference-to-video'], seconds: [4, 15], resolutions: ['768p', '2k'], tag: 'MiniMax H3', tagEn: 'MiniMax H3', note: '4–15 秒 · 768p/2k', noteEn: '4–15 s · 768p/2k' },
];

const MODE_OF = ['text', 'image', 'reference'];
export const VIDEO_GEN_MODES = ['text', 'image', 'reference'];
const MODE_LABEL = { text: '文生视频', image: '图生视频', reference: '参考图生视频' };
const MODE_LABEL_EN = { text: 'Text-to-video', image: 'Image-to-video', reference: 'Reference-to-video' };

// 设置页下拉用的完整目录（文档表格共 18 个：6 个模型族 × 文生 / 图生 / 参考图生）
export const VIDEO_GEN_MODELS = FAMILIES.flatMap((f) => f.ids.map((id, i) => ({
  id,
  label: `${f.family} · ${MODE_LABEL[MODE_OF[i]]}`,
  family: f.family,
  mode: MODE_OF[i],
  seconds: f.seconds,
  resolutions: f.resolutions,
  tag: f.tag,
  tagEn: f.tagEn,
  note: `${MODE_LABEL[MODE_OF[i]]} · ${f.note}`,
  noteEn: `${MODE_LABEL_EN[MODE_OF[i]]} · ${f.noteEn}`,
})));

export const DEFAULT_VIDEO_GEN_MODEL = 'seedance-2-0-mini-text-to-video-basic';

// 设置页下拉菜单：每族一项。文生 / 图生 / 参考图三种模式合并在同一型号下，
// 由 Agent 调用 generate_video 时通过 mode 选择（未指定时按是否有参考图自动判断）。
export const VIDEO_GEN_MENU = FAMILIES.map((f) => {
  const isDefault = f.ids[0] === DEFAULT_VIDEO_GEN_MODEL;
  return {
    id: f.ids[0], label: f.family, tag: isDefault ? '默认' : '多模式', tagEn: isDefault ? 'Default' : 'Multi-mode',
    note: `${f.seconds[0]}–${f.seconds[1]} 秒 · ${f.resolutions.join('/')}`,
    noteEn: `${f.seconds[0]}–${f.seconds[1]} s · ${f.resolutions.join('/')}`, family: f.family,
  };
});

// 把任一目录 ID 映射到菜单项（旧设置里保存的图生 ID 显示为同族合并项）
export function videoMenuIdOf(id) {
  const spec = videoGenModelSpec(id);
  if (!spec) return DEFAULT_VIDEO_GEN_MODEL;
  return VIDEO_GEN_MENU.find((m) => m.family === spec.family)?.id || DEFAULT_VIDEO_GEN_MODEL;
}

export function videoGenModelSpec(id) {
  return VIDEO_GEN_MODELS.find((m) => m.id === id) || null;
}

export function resolveVideoGenModel(id) {
  return videoGenModelSpec(id) ? id : DEFAULT_VIDEO_GEN_MODEL;
}

// 同族的图生视频变体（文生视频模型收到参考图时自动切换）
export function imageVariantOf(id) {
  const spec = videoGenModelSpec(id);
  if (!spec) return null;
  const fam = VIDEO_GEN_MODELS.filter((m) => m.family === spec.family);
  return (fam.find((m) => m.mode === 'image') || null)?.id || null;
}

function evenInt(n) { return Math.max(2, Math.round(n / 2) * 2); }

// 分辨率 + 比例 → WIDTHxHEIGHT（短边取分辨率档位，长边按比例推算，取偶数）
export function videoSizeFor(resolution, aspectRatio) {
  const short = SHORT_SIDE[String(resolution || '').toLowerCase()];
  const [w, h] = String(aspectRatio || '16:9').split(':').map(Number);
  if (!short || !w || !h) return null;
  if (w === h) return `${short}x${short}`;
  if (w > h) return `${evenInt(short * w / h)}x${short}`;
  return `${short}x${evenInt(short * h / w)}`;
}

// 校验并生成请求参数。返回 { ok:true, model, size, seconds, needsImage } 或 { ok:false, error }
export function planVideoRequest({ model, mode, prompt, seconds, resolution, aspectRatio, hasImage }) {
  const text = String(prompt || '').trim();
  if (!text) return { ok: false, error: 'generate_video 需要 prompt（画面与动作描述）。' };
  const base = videoGenModelSpec(model) || videoGenModelSpec(DEFAULT_VIDEO_GEN_MODEL);
  // 生成模式：Agent 指定则用之；未指定时有参考图→图生（参考图型号保持参考图），无参考图→沿用型号自身模式。
  let target = VIDEO_GEN_MODES.includes(mode) ? mode
    : hasImage ? (base.mode === 'reference' ? 'reference' : 'image') : base.mode;
  if (target === 'text' && hasImage) target = 'image'; // 带参考图时不可能是纯文生
  if (!hasImage && target !== 'text') {
    return { ok: false, error: `「${base.family}」的${MODE_LABEL[target]}需要参考图：请传入 input_image（沙箱中的图片路径），或改用文生视频（mode: text）。` };
  }
  const spec = VIDEO_GEN_MODELS.find((m) => m.family === base.family && m.mode === target);
  if (!spec) return { ok: false, error: `「${base.family}」不支持${MODE_LABEL[target]}。` };
  const sec = seconds == null || seconds === '' ? Math.min(Math.max(5, spec.seconds[0]), spec.seconds[1]) : Math.round(Number(seconds));
  if (!Number.isFinite(sec) || sec < spec.seconds[0] || sec > spec.seconds[1]) {
    return { ok: false, error: `「${spec.label}」时长须在 ${spec.seconds[0]}–${spec.seconds[1]} 秒之间（收到 ${seconds}）。` };
  }
  const res = String(resolution || spec.resolutions[0]).toLowerCase();
  if (!spec.resolutions.includes(res)) {
    return { ok: false, error: `「${spec.label}」支持的分辨率：${spec.resolutions.join(' / ')}（收到 ${resolution}）。` };
  }
  const ratio = String(aspectRatio || '16:9');
  if (!VIDEO_GEN_ASPECT_RATIOS.includes(ratio)) {
    return { ok: false, error: `画面比例须为 ${VIDEO_GEN_ASPECT_RATIOS.join(' / ')} 之一（收到 ${aspectRatio}）。` };
  }
  return { ok: true, model: spec.id, mode: target, size: videoSizeFor(res, ratio), seconds: sec, resolution: res, aspectRatio: ratio, needsImage: target !== 'text' };
}

// POST /v1/videos 的 JSON 请求体。seconds 按文档为字符串整数。
export function buildVideoBody(plan, prompt, imageDataUrl, { endImageUrl = '', audio } = {}) {
  const body = { model: plan.model, prompt: String(prompt).trim(), seconds: String(plan.seconds), size: plan.size };
  // 文档：input_reference 为 {"image_url": URL 或 data URL}
  if (imageDataUrl) body.input_reference = { image_url: imageDataUrl };
  // 模型专属扩展（OpenAPI video-openapi.json）：end_image_url 尾帧、audio 音轨开关；未指定则不发送，沿用模型默认
  if (endImageUrl) body.end_image_url = endImageUrl;
  if (typeof audio === 'boolean') body.audio = audio;
  return body;
}

// POST /v1/videos/quote 的请求体：字段与 /v1/videos 一致的生成参数，但 duration 为 "4s" 形式，并带上同一份媒体以保证报价对应。
export function buildVideoQuoteBody(plan, imageDataUrl, { endImageUrl = '', audio } = {}) {
  const body = { model: plan.model, duration: `${plan.seconds}s`, aspect_ratio: plan.aspectRatio, resolution: plan.resolution };
  if (typeof audio === 'boolean') body.audio = audio;
  if (imageDataUrl) body.image_url = imageDataUrl;
  if (endImageUrl) body.end_image_url = endImageUrl;
  return body;
}

export const VIDEO_TERMINAL_OK = 'completed';
export const VIDEO_TERMINAL_FAIL = new Set(['failed', 'cancelled', 'canceled', 'expired']);

// 轮询结果判定：返回 'done' | 'failed' | 'pending'
export function videoJobState(job) {
  const status = String(job && job.status || '').toLowerCase();
  if (status === VIDEO_TERMINAL_OK) return 'done';
  if (VIDEO_TERMINAL_FAIL.has(status)) return 'failed';
  return 'pending';
}

export function videoJobError(job) {
  const e = job && job.error;
  if (!e) return `视频任务失败（status=${job && job.status}）`;
  if (typeof e === 'string') return e;
  return e.message || JSON.stringify(e).slice(0, 300);
}

export const VIDEO_POLL_INTERVAL_MS = 5000;
export const VIDEO_MAX_WAIT_MS = 15 * 60 * 1000;
export const VIDEO_SANDBOX_MAX_BYTES = 16 * 1024 * 1024;
