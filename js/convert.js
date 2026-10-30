// ─── 媒体格式转换（V1.8.1 新增 · convert_file 工具的引擎）────────────────────────────
// 三条通路，能本地做的绝不下载依赖：
//   · canvas：图片互转（png/jpg/webp，含 SVG/位图 → 位图），纯浏览器图像管线；
//   · WebAudio：任意可解码音频 → WAV（16bit PCM），无需任何外部库；
//   · ffmpeg.wasm（@ffmpeg/core 0.12.10，jsDelivr 固定版本、独立 classic Worker 加载）：
//     其余音视频互转 / 容器重封装 / 剪辑 / 提取音轨 / GIF。首次使用时按需下载（core.js 112KB
//     + wasm 32MB，随后可复用浏览器缓存），失败原样回报，绝不静默降格为「假装成功」。
// 计划与参数拼装都是纯函数，可在无 DOM 环境单测。
export const FFMPEG_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
export const MAX_CONVERT_INPUT = 64 * 1024 * 1024;

export const IMAGE_TO = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' });
export const AUDIO_TO = Object.freeze({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac' });
export const VIDEO_TO = Object.freeze({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', gif: 'image/gif' });
const RASTER_IN = /^(?:image\/(?:png|jpeg|webp|gif|bmp|avif|svg\+xml)|video\/x-ms-bmp)$/;
const AUDIO_IN = /^audio\//;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

/**
 * 决定转换通路。返回 {mode:'canvas'|'wav'|'ffmpeg', outExt, outMime} 或 null（不支持）。
 * fromExt / mime 用于判断输入类别；opts.duration/quality 等只影响 ffmpeg 参数。
 */
export function planConversion({ fromExt = '', mime = '', to = '' } = {}) {
  const t = String(to || '').toLowerCase().replace(/^\./, '');
  const inImage = RASTER_IN.test(mime) || /^(?:png|jpe?g|webp|gif|bmp|avif|svg)$/.test(fromExt);
  const inAudio = AUDIO_IN.test(mime) || Object.prototype.hasOwnProperty.call(AUDIO_TO, fromExt);
  const inVideo = /^video\//.test(mime) || /^(?:mp4|webm|mov|m4v|avi|mkv|flv|wmv)$/.test(fromExt);
  if (inImage && IMAGE_TO[t] && t !== 'svg') return { mode: 'canvas', outExt: t === 'jpeg' ? 'jpg' : t, outMime: IMAGE_TO[t] };
  if (inImage && t === 'svg') return null; // 浏览器不产出 SVG（需要排版引擎），明确拒绝而不是糊一个
  if (t === 'wav' && inAudio) return { mode: 'wav', outExt: 'wav', outMime: 'audio/wav' };
  if (AUDIO_TO[t] && (inAudio || inVideo)) return { mode: 'ffmpeg', outExt: t, outMime: AUDIO_TO[t], audioOnly: true };
  if (t === 'wav' && inVideo) return { mode: 'ffmpeg', outExt: 'wav', outMime: 'audio/wav', audioOnly: true };
  if (VIDEO_TO[t] && inVideo) return { mode: 'ffmpeg', outExt: t, outMime: VIDEO_TO[t], audioOnly: false };
  if (IMAGE_TO[t] && inVideo) return { mode: 'ffmpeg', outExt: t === 'jpeg' ? 'jpg' : t, outMime: IMAGE_TO[t], frame: true };
  return null;
}

/** ffmpeg CLI 参数（不含可执行名）。纯函数，可单测。 */
export function ffmpegArgs({ outExt = 'mp4', opts = {}, audioOnly = false, frame = false, outFile = '' } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  const start = clamp(opts.start, 0, 24 * 3600);
  if (start > 0) args.push('-ss', String(start));
  const dur = clamp(opts.duration, 0, 24 * 3600);
  args.push('-i', 'in.bin');
  if (dur > 0) args.push('-t', String(dur));

  const filters = [];
  const fps = clamp(opts.fps, 0, 120);
  if (fps > 0 && !audioOnly && outExt !== 'gif') filters.push(`fps=${fps}`);
  const w = clamp(opts.width, 0, 7680);
  const h = clamp(opts.height, 0, 4320);
  if (w > 0 || h > 0) filters.push(`scale=${w > 0 ? Math.round(w / 2) * 2 : '-2'}:${h > 0 ? Math.round(h / 2) * 2 : '-2'}`);

  const mute = !!opts.mute;
  const q = opts.quality ? clamp(opts.quality, 1, 100) : 80;
  if (audioOnly) {
    args.push('-vn'); // 提取音轨时 mute 无意义，忽略
    if (outExt === 'mp3') args.push('-c:a', 'libmp3lame', '-q:a', String(Math.max(0, Math.min(9, Math.round((100 - q) / 11)))));
    else if (outExt === 'ogg' || outExt === 'opus') args.push('-c:a', outExt === 'opus' ? 'libopus' : 'libvorbis', '-b:a', String(clamp(opts.bitrate ? opts.bitrate * 1000 : 128, 32, 512)) + 'k');
    else if (outExt === 'flac') args.push('-c:a', 'flac');
    else if (outExt === 'wav') args.push('-c:a', 'pcm_s16le');
    else args.push('-c:a', 'aac', '-b:a', String(clamp(opts.bitrate ? opts.bitrate * 1000 : 128, 32, 512)) + 'k');
    return args.concat(outFile || `out.${outExt}`);
  }
  if (frame) {
    if (filters.length) args.push('-vf', filters.join(','));
    args.push('-frames:v', '1');
    return args.concat(outFile || `out.${outExt}`);
  }
  if (outExt === 'gif') {
    args.push('-vf', `fps=${fps > 0 ? fps : 12}${(w > 0 || h > 0) ? ',scale=' + (w > 0 ? Math.round(w / 2) * 2 : -1) + ':-1' : ',scale=480:-1'}`);
    return args.concat(outFile || 'out.gif');
  }
  const br = clamp(opts.bitrate || 0, 0, 40000); // kbps
  if (outExt === 'webm') args.push('-c:v', 'libvpx', '-deadline', 'good', '-cpu-used', '4');
  else args.push('-c:v', 'libx264', '-preset', 'veryfast');
  if (br > 0) args.push('-b:v', br + 'k');
  else if (outExt === 'webm') args.push('-b:v', '1M');
  else args.push('-crf', String(Math.max(16, Math.min(34, 30 - Math.round(q / 5)))), '-pix_fmt', 'yuv420p');
  if (filters.length) args.push('-vf', filters.join(','));
  if (mute) args.push('-an');
  else if (outExt === 'webm') args.push('-c:a', 'libvorbis', '-q:a', '5');
  else args.push('-c:a', 'aac', '-b:a', '128k');
  if (outExt === 'mp4' || outExt === 'mov') args.push('-movflags', '+faststart');
  return args.concat(outFile || `out.${outExt}`);
}

// ── canvas：图片互转（含 SVG 输入；1×~4× 可控）─────────────────────────────────────
export async function convertImageCanvas(bytes, mime, { outExt = 'png', opts = {} } = {}) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('图像解码失败（格式不支持或数据损坏）'));
      img.src = url;
    });
    let dw = img.naturalWidth || 0;
    let dh = img.naturalHeight || 0;
    if ((!dw || !dh) && (mime || '').includes('svg')) { dw = 800; dh = 600; }
    if (!dw || !dh) throw new Error('图像没有可读取的尺寸');
    let w = dw;
    let h = dh;
    if (opts.width > 0 || opts.height > 0) {
      const tw = clamp(opts.width, 1, 4096) || Math.round(dw * (clamp(opts.height, 1, 4096) / dh));
      const th = clamp(opts.height, 1, 4096) || Math.round(dh * (clamp(opts.width, 1, 4096) / dw));
      w = Math.max(1, tw);
      h = Math.max(1, th);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (outExt === 'jpg' || outExt === 'jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const type = outExt === 'jpg' || outExt === 'jpeg' ? 'image/jpeg' : outExt === 'webp' ? 'image/webp' : 'image/png';
    const quality = outExt === 'png' ? undefined : Math.max(0.3, Math.min(1, (opts.quality ? clamp(opts.quality, 1, 100) : 92) / 100));
    const blob = await new Promise((res) => canvas.toBlob((b) => res(b), type, quality));
    if (!blob) throw new Error(`浏览器无法编码为 ${outExt}`);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── WebAudio：可解码音频 → 16bit PCM WAV（无外部依赖）────────────────────────────────
export async function convertToWav(bytes) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('浏览器不支持 AudioContext');
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(bytes.slice().buffer);
    return encodeWav(buf);
  } finally {
    try { await ctx.close(); } catch { /* 已关闭 */ }
  }
}

export function encodeWav(audioBuffer) {
  const ch = Math.min(2, audioBuffer.numberOfChannels || 1);
  const sr = audioBuffer.sampleRate || 44100;
  const len = audioBuffer.length;
  const out = new Uint8Array(44 + len * ch * 2);
  const dv = new DataView(out.buffer);
  const tag = (at, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)); };
  tag(0, 'RIFF'); dv.setUint32(4, 36 + len * ch * 2, true); tag(8, 'WAVE');
  tag(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
  tag(36, 'data'); dv.setUint32(40, len * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(audioBuffer.getChannelData(c));
  let at = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i] || 0));
      dv.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      at += 2;
    }
  }
  return out;
}

// ── ffmpeg Worker：延迟装配 + 单次转换（带超时与整体复用）──────────────────────────
const FFMPEG_TIMEOUT_MS = 180000;
let worker = null;
let workerBad = false;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (workerBad) throw new Error('ffmpeg 引擎不可用（本页面此前加载失败；图片 / WAV 转换仍可用）');
  if (worker) return worker;
  const url = new URL('./worker-convert.js', import.meta.url).href;
  const w = new Worker(url);
  worker = w;
  w.onmessage = (e) => {
    const m = e.data || {};
    const p = pending.get(m.id);
    if (!p) return;
    if (m.loading) { p.onProgress?.({ loading: true, ...m.loading }); return; } // 首次加载 core 的下载 / 初始化进度
    if (m.progress != null) { p.onProgress?.(m.progress); return; } // 进度（含 0%）不终结任务；曾用真值判断导致首帧进度被当成失败
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(new Uint8Array(m.bytes));
    else {
      if (m.fatal) { workerBad = true; try { w.terminate(); } catch { /* noop */ } worker = null; }
      p.reject(new Error(m.error || 'ffmpeg 转换失败'));
    }
  };
  w.onerror = () => {
    workerBad = true;
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error('ffmpeg Worker 崩溃')); }
    pending.clear();
    try { w.terminate(); } catch { /* noop */ }
    worker = null;
  };
  return w;
}

export function convertWithFfmpeg(bytes, args, { onProgress } = {}) {
  const w = ensureWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`ffmpeg 转换超时（${Math.round(FFMPEG_TIMEOUT_MS / 1000)}s）${args.includes('-ss') ? '：可先用更小的 start/duration 区间' : ''}`));
    }, FFMPEG_TIMEOUT_MS);
    pending.set(id, { resolve, reject, onProgress, timer });
    w.postMessage({ id, args, bytes: bytes.buffer }, [bytes.buffer]);
  });
}

export function convertProgressNote(p) {
  const out = p == null ? '' : String(p);
  return out ? `ffmpeg ${out}` : 'ffmpeg 转换中…';
}

/** 汇总入口：按 plan 分发。返回 { bytes, outMime, outName?, mode }。 */
export async function runConversion({ bytes, mime, plan, outName, opts = {}, onProgress }) {
  if (plan.mode === 'canvas') {
    return { bytes: await convertImageCanvas(bytes, mime, { outExt: plan.outExt, opts }), outMime: plan.outMime, mode: 'canvas' };
  }
  if (plan.mode === 'wav') {
    return { bytes: await convertToWav(bytes), outMime: 'audio/wav', mode: 'webaudio' };
  }
  const args = ffmpegArgs({ outExt: plan.outExt, opts, audioOnly: !!plan.audioOnly, frame: !!plan.frame });
  const out = await convertWithFfmpeg(bytes, args, { onProgress });
  void outName;
  return { bytes: out, outMime: plan.outMime, mode: 'ffmpeg' };
}
