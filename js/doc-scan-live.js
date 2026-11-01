// Dubhe Agent · 文稿扫描实时取景角点（第 18 条）
// 取景时按节流（默认约 5 次/秒）抽取降采样帧，交给 Worker 检测；同一时间最多一帧在途，
// 结果未返回前的帧直接丢弃，不排队，主线程只负责画线。Worker 不可用时退回主线程，但仍节流。
import { detectDocCorners } from './doc-scanner.js';

export const LIVE_DETECT_EDGE = 240;
export const LIVE_INTERVAL_MS = 200;
const SMOOTH = 0.5;      // 新旧角点的插值系数：抑制抖动
const JUMP_PX = 40;      // 角点平均位移超过此值视为换页，直接跳到新位置

export function liveSmoothQuad(prev, next, jumpPx = JUMP_PX, alpha = SMOOTH) {
  if (!next) return null;
  if (!prev || prev.length !== next.length) return next;
  let moved = 0;
  for (let i = 0; i < next.length; i++) moved += Math.hypot(next[i].x - prev[i].x, next[i].y - prev[i].y);
  if (moved / next.length > jumpPx) return next;
  return next.map((p, i) => ({ x: prev[i].x + (p.x - prev[i].x) * alpha, y: prev[i].y + (p.y - prev[i].y) * alpha }));
}

export function createLiveDetector({ makeWorker = null, doc = globalThis.document } = {}) {
  let worker = null;
  let workerFailed = false;
  let inFlight = null; // { id } 或 null
  let seq = 0;
  const pending = new Map();
  let scratch = null; // 复用同一个降采样画布，避免每帧分配

  const ensureWorker = () => {
    if (worker || workerFailed) return worker;
    try {
      worker = makeWorker ? makeWorker() : new Worker(new URL('./doc-scan-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event) => {
        const { id, quad } = event.data || {};
        const resolve = pending.get(id);
        if (resolve) { pending.delete(id); resolve(quad || null); }
      };
      worker.onerror = () => {
        workerFailed = true;
        try { worker.terminate(); } catch { /* noop */ }
        worker = null;
        for (const resolve of pending.values()) resolve(null);
        pending.clear();
      };
    } catch {
      workerFailed = true;
      worker = null;
    }
    return worker;
  };

  /** 把视频当前帧降采样成小图；返回 { width, height, imageData } 或 null（画面未就绪）。 */
  function grabFrame(video) {
    const vw = video.videoWidth; const vh = video.videoHeight;
    if (!vw || !vh || !doc) return null;
    const s = Math.min(1, LIVE_DETECT_EDGE / Math.max(vw, vh));
    const width = Math.max(16, Math.round(vw * s));
    const height = Math.max(16, Math.round(vh * s));
    if (!scratch) scratch = doc.createElement('canvas');
    scratch.width = width; scratch.height = height;
    const g = scratch.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(video, 0, 0, width, height);
    return { width, height, imageData: g.getImageData(0, 0, width, height) };
  }

  /**
   * 对当前视频帧做一次检测。返回 Promise<{ quad, sourceWidth, sourceHeight } | null>。
   * 在途时直接返回 null（丢帧），不会堆积。
   */
  async function detect(video) {
    if (inFlight) return null;
    const frame = grabFrame(video);
    if (!frame) return null;
    const scaleBack = { x: video.videoWidth / frame.width, y: video.videoHeight / frame.height };
    const finish = (quad) => {
      if (!quad) return null;
      return {
        quad: quad.map((p) => ({ x: p.x * scaleBack.x, y: p.y * scaleBack.y })),
        sourceWidth: video.videoWidth,
        sourceHeight: video.videoHeight,
      };
    };
    const w = ensureWorker();
    if (w) {
      const id = ++seq;
      inFlight = { id };
      try {
        const buffer = frame.imageData.data.buffer;
        const quad = await new Promise((resolve) => {
          pending.set(id, resolve);
          w.postMessage({ id, width: frame.width, height: frame.height, buffer }, [buffer]);
        });
        return finish(quad);
      } finally {
        inFlight = null;
      }
    }
    // 退回主线程：仍然由调用方节流，单帧计算量很小（约 240px 长边）
    inFlight = { id: 0 };
    try { return finish(detectDocCorners(frame.imageData)); } finally { inFlight = null; }
  }

  function dispose() {
    if (worker) { try { worker.terminate(); } catch { /* noop */ } }
    worker = null;
    pending.clear();
    inFlight = null;
  }

  return { detect, dispose, get usingWorker() { return !!worker; } };
}
