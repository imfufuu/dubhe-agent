// 视频生成（TeamoRouter /v1/videos）：模型目录、参数校验、请求体构造、轮询判定。
// 纯函数，不发请求；网络调用在 api.js（createVideoJob / getVideoJob / fetchVideoContent）。
// 依据：https://teamorouter.cn/zh/docs/video-generation-api（2026-10 文档）。
// 注意：文档只给了参数规格，沙箱无法访问网关，未做过真实生成测试。

export const VIDEO_GEN_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

// 分辨率档位 → 短边像素（size = WIDTHxHEIGHT 由短边与比例推出）
const SHORT_SIDE = { '480p': 480, '720p': 720, '768p': 768, '1080p': 1080, '2k': 1440, '4k': 2160 };

// 六个模型族，每族三个变体：文生视频 / 图生视频 / 参考图生视频
const FAMILIES = [
  // Seedance 2.5 Flex / Flex R2V 是 2.5 的变体（仅文生与参考图生，无图生），归入同族
  { family: 'Seedance 2.5', ids: ['seedance-2-5-text-to-video-basic', 'seedance-2-5-image-to-video-basic', 'seedance-2-5-reference-to-video-basic'], flexIds: ['seedance-2-5-text-to-video-flex', null, 'seedance-2-5-reference-to-video-flex'], seconds: [4, 30], resolutions: ['480p', '720p', '1080p'], tag: 'Seedance 2.5 · 最新', tagEn: 'Seedance 2.5 · newest', note: '4–30 秒 · 480p/720p/1080p', noteEn: '4–30 s · 480p/720p/1080p' },
  { family: 'Seedance 2.0', ids: ['seedance-2-0-text-to-video-basic', 'seedance-2-0-image-to-video-basic', 'seedance-2-0-reference-to-video-basic'], seconds: [4, 15], resolutions: ['480p', '720p', '1080p', '4k'], tag: 'Seedance 2.0 · 高质', tagEn: 'Seedance 2.0 · high quality', note: '4–15 秒 · 最高 4K', noteEn: '4–15 s · up to 4K' },
  // 折叠变体：与 Flex 相同，归入 Seedance 2.0 家族，不单独占菜单项；分辨率/时长仍按各自规格校验
  { family: 'Seedance 2.0', folded: 'fast', ids: ['seedance-2-0-fast-text-to-video-basic', 'seedance-2-0-fast-image-to-video-basic', 'seedance-2-0-fast-reference-to-video-basic'], seconds: [4, 15], resolutions: ['480p', '720p'], tag: 'Seedance 2.0 · 快速', tagEn: 'Seedance 2.0 · fast', note: '4–15 秒 · 480p/720p', noteEn: '4–15 s · 480p/720p' },
  { family: 'Seedance 2.0', folded: 'mini', ids: ['seedance-2-0-mini-text-to-video-basic', 'seedance-2-0-mini-image-to-video-basic', 'seedance-2-0-mini-reference-to-video-basic'], seconds: [4, 15], resolutions: ['480p', '720p'], tag: 'Seedance 2.0 · 低价', tagEn: 'Seedance 2.0 · cheap', note: '4–15 秒 · 480p/720p', noteEn: '4–15 s · 480p/720p' },
  { family: 'MiniMax H3 Max', ids: ['minimax-h3-max-text-to-video', 'minimax-h3-max-image-to-video', 'minimax-h3-max-reference-to-video'], seconds: [4, 15], resolutions: ['768p'], tag: 'MiniMax H3 Max', tagEn: 'MiniMax H3 Max', note: '4–15 秒 · 768p', noteEn: '4–15 s · 768p' },
  { family: 'MiniMax H3', ids: ['minimax-h3-text-to-video', 'minimax-h3-image-to-video', 'minimax-h3-reference-to-video'], seconds: [4, 15], resolutions: ['768p', '2k'], tag: 'MiniMax H3', tagEn: 'MiniMax H3', note: '4–15 秒 · 768p/2k', noteEn: '4–15 s · 768p/2k' },
];

const MODE_OF = ['text', 'image', 'reference'];
export const VIDEO_GEN_MODES = ['text', 'image', 'reference'];
const MODE_LABEL = { text: '文生视频', image: '图生视频', reference: '参考图生视频' };
const MODE_LABEL_EN = { text: 'Text-to-video', image: 'Image-to-video', reference: 'Reference-to-video' };

// 设置页下拉用的完整目录（文档表格共 18 个：6 个模型族 × 文生 / 图生 / 参考图生）
const VARIANT_LABEL = { basic: '', flex: ' Flex', fast: ' Fast', mini: ' Mini' };
function videoEntry(f, id, i, variant) {
  return {
    id,
    label: `${f.family}${VARIANT_LABEL[variant] || ''} · ${MODE_LABEL[MODE_OF[i]]}`,
    family: f.family,
    variant,
    mode: MODE_OF[i],
    seconds: f.seconds,
    resolutions: f.resolutions,
    tag: f.tag,
    tagEn: f.tagEn,
    note: `${MODE_LABEL[MODE_OF[i]]} · ${f.note}`,
    noteEn: `${MODE_LABEL_EN[MODE_OF[i]]} · ${f.noteEn}`,
  };
}
export const VIDEO_GEN_MODELS = FAMILIES.flatMap((f) => (f.folded
  ? f.ids.map((id, i) => videoEntry(f, id, i, f.folded))
  : [
    ...f.ids.map((id, i) => videoEntry(f, id, i, 'basic')),
    ...(f.flexIds || []).flatMap((id, i) => (id ? [videoEntry(f, id, i, 'flex')] : [])),
  ]));

export const DEFAULT_VIDEO_GEN_MODEL = 'seedance-2-0-text-to-video-basic'; // 菜单中的 Seedance 2.0 项（Fast/Mini 已折叠，不能作默认）

// 支持 negative_prompt 的模型 ID。只有在此登记（并经 GET /v1/models?type=video 核实）的模型才会发送该字段。
// 现状：公开文档只给出 OpenAPI 的通用字段，未列出逐模型支持表；MiniMax H3 官方请求体无此字段；
// 用户提供的 Seedance / MiniMax 请求格式清单中也不含 negative_prompt。
// 生图侧：GPT 图像系列（OpenAI 官方）与 Nano Banana（Gemini）均无负面提示词字段，应写进正向 prompt。
// 因此集合暂为空：Agent 传入的负面提示词不会发出，结果里会明确说明，而不是静默丢弃。
export const NEGATIVE_PROMPT_MODELS = new Set([]);
export const NEGATIVE_PROMPT_MAX = 2500; // OpenAPI 默认上限（个别模型可到 20000）

// 设置页下拉菜单：每族一项。文生 / 图生 / 参考图三种模式合并在同一型号下，
// 由 Agent 调用 generate_video 时通过 mode 选择（未指定时按是否有参考图自动判断）。
export const VIDEO_GEN_MENU = FAMILIES.filter((f) => !f.folded).map((f) => {
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


// Report only the selected family's configured variants; catalogue entries are not live availability checks.
export function videoModelRuntimeDescription(id, { gatewayId = 'teamorouter' } = {}) {
  const selected = videoGenModelSpec(resolveVideoGenModel(id));
  if (gatewayId !== 'teamorouter') return `${selected.family}；当前网关未接通视频生成，没有可用变体。`;
  const list = VIDEO_GEN_MODELS.filter(m => m.family === selected.family)
    .map(m => `${m.id} (${m.label}；${m.seconds[0]}–${m.seconds[1]}秒；${m.resolutions.join('/')})`).join(', ');
  return `${selected.family}；当前系列可选模型：${list}；generate_video 的 variant 可直接填写上述确切 ID，mode 选择生成模式；不得跨系列。目录不保证网关实时可用，实际以上游响应为准。`;
}
// 同族的图生视频变体（文生视频模型收到参考图时自动切换）
export function imageVariantOf(id) {
  const spec = videoGenModelSpec(id);
  if (!spec) return null;
  const fam = VIDEO_GEN_MODELS.filter((m) => m.family === spec.family && m.mode === 'image');
  // 优先同一变体（Fast 切 Fast 图生，Mini 切 Mini 图生），没有再回落到基础版
  return (fam.find((m) => m.variant === spec.variant) || fam.find((m) => m.variant === 'basic') || null)?.id || null;
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
export function planVideoRequest({ model, mode, prompt, seconds, resolution, aspectRatio, hasImage, negativePrompt }) {
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
  // 同族内优先沿用锚定型号的变体（如 Flex）；该变体无此模式时回落到同族基础版
  const sameFamily = VIDEO_GEN_MODELS.filter((m) => m.family === base.family && m.mode === target);
  const spec = sameFamily.find((m) => m.variant === base.variant) || sameFamily.find((m) => m.variant === 'basic') || null;
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
  // 负面提示词：仅支持的模型发送；否则记录为已丢弃，由调用方告知用户
  const neg = String(negativePrompt || '').trim().slice(0, NEGATIVE_PROMPT_MAX);
  const negSupported = NEGATIVE_PROMPT_MODELS.has(spec.id);
  return {
    ok: true, model: spec.id, mode: target, size: videoSizeFor(res, ratio), seconds: sec, resolution: res, aspectRatio: ratio, needsImage: target !== 'text',
    negativePrompt: negSupported && neg ? neg : '',
    negativePromptDropped: !negSupported && !!neg,
  };
}

// POST /v1/videos 的 JSON 请求体。seconds 按文档为字符串整数。
export function buildVideoBody(plan, prompt, imageDataUrl, { endImageUrl = '', audio, extras } = {}) {
  const body = { model: plan.model, prompt: String(prompt).trim(), seconds: String(plan.seconds), size: plan.size };
  // 文档：input_reference 为 {"image_url": URL 或 data URL}
  if (imageDataUrl) body.input_reference = { image_url: imageDataUrl };
  // 模型专属扩展（OpenAPI video-openapi.json）：end_image_url 尾帧、audio 音轨开关；未指定则不发送，沿用模型默认
  if (endImageUrl) body.end_image_url = endImageUrl;
  if (typeof audio === 'boolean') body.audio = audio;
  if (plan.negativePrompt) body.negative_prompt = plan.negativePrompt;
  // 其余生成参数（已由 pickVideoExtras 校验）；不覆盖 model / prompt / seconds / size
  for (const [k, v] of Object.entries(extras || {})) if (!(k in body)) body[k] = v;
  return body;
}

// POST /v1/videos/quote 的请求体：字段与 /v1/videos 一致的生成参数，但 duration 为 "4s" 形式，并带上同一份媒体以保证报价对应。
export function buildVideoQuoteBody(plan, imageDataUrl, { endImageUrl = '', audio, extras } = {}) {
  const body = { model: plan.model, duration: `${plan.seconds}s`, aspect_ratio: plan.aspectRatio, resolution: plan.resolution };
  if (typeof audio === 'boolean') body.audio = audio;
  if (imageDataUrl) body.image_url = imageDataUrl;
  if (endImageUrl) body.end_image_url = endImageUrl;
  for (const [k, v] of Object.entries(extras || {})) if (!(k in body)) body[k] = v;
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

// ── 其余生成参数（Seedance / MiniMax 共用请求格式；字段名即请求体键名）──
// 未提供则不发送，沿用模型默认。范围依据 video-openapi.json；模型级限制以网关 GET /models 为准，
// 网关拒绝时原样把错误返回给 Agent。媒体类字段接受 URL、data URL 或沙箱内路径（由调用方解析）。
export const VIDEO_EXTRA_SPEC = Object.freeze({
  image_strength: { type: 'number', min: 0, max: 1 },
  reference_image_urls: { type: 'media[]', max: 30 },
  reference_video_urls: { type: 'media[]', max: 10 },
  reference_audio_urls: { type: 'media[]', max: 10 },
  reference_document_urls: { type: 'media[]', max: 1 },
  elements: { type: 'elements', max: 4 },
  scene_image_urls: { type: 'media[]', max: 4 },
  keyframes: { type: 'keyframes', max: 10 },
  camera_trajectory: { type: 'object[]', min: 2, max: 12 },
  omni_reference_task_type: { type: 'string' },
  upscale_factor: { type: 'integer', enum: [1, 2, 4] },
  enhancement_model: { type: 'string' },
  target_fps: { type: 'integer', min: 16, max: 120 },
  slowdown_factor: { type: 'integer', enum: [1, 2, 4, 8] },
  softness: { type: 'number', min: 1, max: 5 },
  creativity: { type: 'number', min: 0, max: 1 },
  realism: { type: 'number', min: 0, max: 1 },
  sharp: { type: 'number', min: 0, max: 1 },
  compression: { type: 'number', min: 0, max: 1 },
  noise: { type: 'number', min: 0, max: 1 },
  halo: { type: 'number', min: 0, max: 1 },
  grain: { type: 'number', min: 0, max: 0.1 },
  recover_detail: { type: 'number', min: 0, max: 1 },
  h264_output: { type: 'boolean' },
  output_format: { type: 'string', enum: ['mp4', 'prores'] },
  reference_video_total_duration: { type: 'number', min: 0 },
  consents: { type: 'object' },
});

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// 校验并规范化额外参数。resolveMedia(value) → 可用的 URL / data URL，无法解析时返回 ''。
// 返回 { extras, errors }：extras 只含通过校验且有值的字段。
export function pickVideoExtras(args = {}, { resolveMedia = (v) => String(v || '') } = {}) {
  const extras = {};
  const errors = [];
  const media = (name, v) => {
    const s = String(v || '').trim();
    const out = s ? resolveMedia(s) : '';
    if (!out) errors.push(`${name}：无法读取「${s}」（需为 http(s) URL、data URL 或沙箱内存在的文件）`);
    return out;
  };
  for (const [name, spec] of Object.entries(VIDEO_EXTRA_SPEC)) {
    const raw = args[name];
    if (raw === undefined || raw === null || raw === '') continue;
    if (spec.type === 'number' || spec.type === 'integer') {
      const n = Number(raw);
      if (!Number.isFinite(n) || (spec.type === 'integer' && !Number.isInteger(n))) { errors.push(`${name} 须为${spec.type === 'integer' ? '整数' : '数字'}（收到 ${raw}）`); continue; }
      if ((spec.min != null && n < spec.min) || (spec.max != null && n > spec.max)) { errors.push(`${name} 须在 ${spec.min ?? '-∞'}–${spec.max ?? '∞'} 之间（收到 ${raw}）`); continue; }
      if (spec.enum && !spec.enum.includes(n)) { errors.push(`${name} 只能是 ${spec.enum.join(' / ')}（收到 ${raw}）`); continue; }
      extras[name] = n;
    } else if (spec.type === 'boolean') {
      if (typeof raw !== 'boolean') { errors.push(`${name} 须为 true 或 false`); continue; }
      extras[name] = raw;
    } else if (spec.type === 'string') {
      const s = String(raw).trim();
      if (spec.enum && !spec.enum.includes(s)) { errors.push(`${name} 只能是 ${spec.enum.join(' / ')}（收到 ${raw}）`); continue; }
      if (s) extras[name] = s;
    } else if (spec.type === 'object') {
      if (!isPlainObject(raw)) { errors.push(`${name} 须为对象`); continue; }
      extras[name] = raw;
    } else if (spec.type === 'media[]') {
      const arr = Array.isArray(raw) ? raw : [raw];
      if (arr.length > spec.max) { errors.push(`${name} 最多 ${spec.max} 项（收到 ${arr.length}）`); continue; }
      const urls = arr.map((x) => media(name, x)).filter(Boolean);
      if (urls.length) extras[name] = urls;
    } else if (spec.type === 'object[]') {
      if (!Array.isArray(raw) || !raw.every(isPlainObject)) { errors.push(`${name} 须为对象数组`); continue; }
      if (raw.length > spec.max || (spec.min != null && raw.length < spec.min)) { errors.push(`${name} 需要 ${spec.min ?? 0}–${spec.max} 项（收到 ${raw.length}）`); continue; }
      extras[name] = raw;
    } else if (spec.type === 'elements') {
      if (!Array.isArray(raw) || !raw.every(isPlainObject)) { errors.push('elements 须为对象数组'); continue; }
      if (raw.length > spec.max) { errors.push(`elements 最多 ${spec.max} 项（收到 ${raw.length}）`); continue; }
      extras[name] = raw.map((e) => ({
        ...(e.frontal_image_url ? { frontal_image_url: media('elements.frontal_image_url', e.frontal_image_url) } : {}),
        ...(Array.isArray(e.reference_image_urls) ? { reference_image_urls: e.reference_image_urls.slice(0, 3).map((x) => media('elements.reference_image_urls', x)) } : {}),
        ...(e.video_url ? { video_url: media('elements.video_url', e.video_url) } : {}),
      }));
    } else if (spec.type === 'keyframes') {
      if (!Array.isArray(raw) || !raw.every(isPlainObject)) { errors.push('keyframes 须为 { image_url, frame_index } 数组'); continue; }
      if (raw.length > spec.max) { errors.push(`keyframes 最多 ${spec.max} 项（收到 ${raw.length}）`); continue; }
      const idx = raw.map((k) => k.frame_index);
      if (new Set(idx).size !== idx.length || idx.some((i) => !Number.isInteger(i) || i < 0)) { errors.push('keyframes 的 frame_index 须为互不相同的非负整数'); continue; }
      extras[name] = raw.map((k) => ({ image_url: media('keyframes.image_url', k.image_url), frame_index: k.frame_index }));
    }
  }
  return { extras, errors };
}
