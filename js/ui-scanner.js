// ─── 文档扫描（V1.8.1）：摄像头实时取景 → 自动四角检测 → 拖拽微调 → 透视矫正导出 ───
// 只在有摄像头且 Permissions-Policy 允许的环境出现（ui-devices 控制入口按钮可见性）。
// 算法在 js/doc-scanner.js（纯函数）；这里只负责相机、UI 与产出 File[]。
import { detectDocCorners, computeHomography, warpImageData, applyScanFilter, targetSizeForQuad } from './doc-scanner.js';
import { jpegPagesToPdf } from './doc-scanner.js';

const PREVIEW_EDGE = 980;
const OUTPUT_EDGE = 2400;
const DETECT_EDGE = 320;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function scaleToFit(w, h, edge) {
  const s = Math.max(w, h) > edge ? edge / Math.max(w, h) : 1;
  return { width: Math.max(32, Math.round(w * s)), height: Math.max(32, Math.round(h * s)), s };
}

function imageDataFrom(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** 渲染一页：warp（四边形 → 目标矩形）→ 滤镜。maxEdge 控制长边。返回 canvas。 */
export function renderPage(stillCanvas, quad, filter, maxEdge) {
  const size = targetSizeForQuad(quad, maxEdge);
  const H = computeHomography(quad, size.width, size.height);
  const warped = warpImageData(imageDataFrom(stillCanvas), H, size.width, size.height);
  const filtered = applyScanFilter(warped, filter);
  const out = document.createElement('canvas');
  out.width = filtered.width; out.height = filtered.height;
  out.getContext('2d').putImageData(new ImageData(filtered.data, filtered.width, filtered.height), 0, 0);
  return out;
}

export async function openScanner({ doc = document } = {}) {
  const win = doc.defaultView;
  const media = win.navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error('此浏览器不支持摄像头调用');
  const modal = doc.createElement('div');
  modal.className = 'photo-editor-modal scan-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', '文档扫描');
  modal.innerHTML = `
    <section class="photo-editor scan-sheet" role="document">
      <header class="photo-editor-head">
        <div class="photo-editor-heading">
          <div class="photo-editor-title">文档扫描</div>
          <div class="photo-file-name" data-r="hint" aria-live="polite">正在开启摄像头…</div>
        </div>
        <div class="photo-editor-head-right">
          <span class="photo-local-badge" title="取景、矫正、导出都在浏览器本地完成，不上传">仅本地处理</span>
          <button class="photo-editor-close icon-btn" type="button" data-r="close" aria-label="关闭扫描（Esc）" title="关闭（Esc）"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
      </header>
      <div class="photo-editor-main">
        <div class="photo-stage"><div class="photo-canvas-wrap" data-r="wrap">
          <video class="scan-video" playsinline muted autoplay></video>
          <canvas class="scan-canvas" data-r="canvas" hidden></canvas>
          <canvas class="scan-overlay" data-r="overlay" aria-hidden="true"></canvas>
        </div></div>
      </div>
      <div class="scan-bar" role="toolbar" aria-label="扫描工具">
        <div class="scan-filters" role="group" aria-label="滤镜">
          <button class="scan-f on" type="button" data-f="original">原色</button><button class="scan-f" type="button" data-f="gray">灰度</button><button class="scan-f" type="button" data-f="mono">黑白</button>
        </div>
        <div class="scan-actions">
          <button class="ghost-btn" type="button" data-r="reshoot" hidden>重新取景</button>
          <button class="primary-btn scan-shutter" type="button" data-r="shoot">拍摄</button>
        </div>
        <div class="scan-pages" data-r="pages"></div>
      </div>
      <footer class="photo-editor-foot">
        <div class="photo-editor-hint"><span>拍好后拖动四角可微调边界；扫描件作为附件加入本轮对话。</span></div>
        <div class="photo-footer-actions">
          <button class="ghost-btn" type="button" data-r="cancel">取消</button>
          <button class="ghost-btn" type="button" data-r="save-img" disabled>存为图片</button>
          <button class="primary-btn" type="button" data-r="save-pdf" disabled>导出 PDF</button>
        </div>
      </footer>
    </section>`;
  doc.body.appendChild(modal);
  const $ = (n) => modal.querySelector(`[data-r="${n}"]`);
  const video = modal.querySelector('.scan-video');
  const canvas = $('canvas');
  const overlay = $('overlay');
  const hint = $('hint');
  const pagesEl = $('pages');
  const btnImg = $('save-img');
  const btnPdf = $('save-pdf');
  const btnShoot = $('shoot');
  const btnReshoot = $('reshoot');
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('open')));

  let stream = null;
  let phase = 'live'; // live | review
  let filter = 'original';
  let still = null;            // 冻结帧 canvas（全分辨率）
  let quad = null;             // 全分辨率坐标的四角
  let preview = null;          // 预览渲染结果 canvas
  const pages = [];            // {canvas, name}
  let raf = 0;

  const setHint = (t) => { hint.textContent = t; };
  const start = async () => {
    try {
      stream = await media.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } },
        audio: false,
      });
    } catch {
      stream = await media.getUserMedia({ video: true, audio: false }); // 尽力而为：约束不被支持时退回默认
    }
    video.srcObject = stream;
    await video.play().catch(() => { /* 自动播放策略下点了按钮才播 */ });
    setHint('对准一页文档，尽量让纸面充满画面');
  };

  const stop = () => {
    raf && cancelAnimationFrame(raf); raf = 0;
    if (stream) for (const t of stream.getTracks()) { try { t.stop(); } catch { /* 已停止 */ } }
    stream = null;
    modal.classList.add('closing');
    doc.removeEventListener('keydown', onKey, true);
    setTimeout(() => modal.remove(), 260);
  };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
  }
  doc.addEventListener('keydown', onKey, true);

  let resolve;
  const result = new Promise((r) => { resolve = r; });
  function finish(files) { stop(); resolve(files); }

  const drawOverlay = () => {
    const wr = overlay.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.round(wr.width)); const h = Math.max(1, Math.round(wr.height));
    overlay.width = w; overlay.height = h;
    const g = overlay.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (phase === 'live') return;
    if (!preview || !quad || !still) return;
    const disp = displayScale();
    const pts = quad.map((p) => ({ x: p.x * disp.k + disp.ox, y: p.y * disp.k + disp.oy }));
    g.lineWidth = 2; g.strokeStyle = '#a78bfa'; g.fillStyle = 'rgba(167,139,250,.16)';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath(); g.fill(); g.stroke();
    for (const p of pts) {
      g.beginPath(); g.arc(p.x, p.y, 9, 0, Math.PI * 2);
      g.fillStyle = '#fff'; g.fill();
      g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.fillStyle = '#a78bfa'; g.fill();
    }
  };

  function displayScale() {
    // 对齐坐标系：quad 是原图（still）坐标 → 乘 preview 的显示比例；overlay 与 wrap 同框
    const wr = overlay.parentElement.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    if (!preview || !still || !cr.width) return { k: 1, ox: 0, oy: 0 };
    const css = canvas.offsetWidth ? cr.width / canvas.offsetWidth : 1;
    const k = (preview.width / still.width) * css;
    return { k, ox: cr.left - wr.left, oy: cr.top - wr.top };
  }

  const renderPreview = () => {
    if (!still || !quad) return;
    preview = renderPage(still, quad, filter, PREVIEW_EDGE);
    canvas.width = preview.width; canvas.height = preview.height;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, preview.width, preview.height);
    c.drawImage(preview, 0, 0);
    drawOverlay();
  };
  const schedulePreview = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderPreview(); }); };

  const captureStill = () => {
    const vw = video.videoWidth || 1280; const vh = video.videoHeight || 720;
    const fit = scaleToFit(vw, vh, OUTPUT_EDGE);
    still = doc.createElement('canvas');
    still.width = fit.width; still.height = fit.height;
    still.getContext('2d').drawImage(video, 0, 0, fit.width, fit.height);
    quad = detectQuadOnStill();
  };

  function detectQuadOnStill() {
    const fit = scaleToFit(still.width, still.height, DETECT_EDGE);
    const small = doc.createElement('canvas');
    small.width = fit.width; small.height = fit.height;
    small.getContext('2d').drawImage(still, 0, 0, fit.width, fit.height);
    const found = detectDocCorners(imageDataFrom(small));
    const back = 1 / fit.s;
    if (found) return found.map((p) => ({ x: clamp(p.x * back, 0, still.width), y: clamp(p.y * back, 0, still.height) }));
    const m = Math.round(Math.min(still.width, still.height) * 0.04);
    return [{ x: m, y: m }, { x: still.width - m, y: m }, { x: still.width - m, y: still.height - m }, { x: m, y: still.height - m }];
  }

  const toLive = () => {
    phase = 'live';
    video.hidden = false; canvas.hidden = true; still = null; quad = null; preview = null;
    $('shoot').textContent = '拍摄';
    btnReshoot.hidden = true;
    setHint('对准一页文档，尽量让纸面充满画面');
    drawOverlay();
  };
  const toReview = () => {
    phase = 'review';
    video.hidden = true; canvas.hidden = false;
    btnShoot.textContent = '加入这一页';
    btnReshoot.hidden = false;
    setHint('拖动四角微调范围，选滤镜后加入本页');
    renderPreview();
  };

  // 指针拖角
  let dragIdx = -1;
  overlay.addEventListener('pointerdown', (e) => {
    if (phase !== 'review') return;
    const r = overlay.getBoundingClientRect();
    const x = (e.clientX - r.left); const y = (e.clientY - r.top);
    const disp = displayScale();
    let best = -1; let bestD = 28 * 28;
    quad.forEach((p, i) => {
      const dx = p.x * disp.k + disp.ox - x; const dy = p.y * disp.k + disp.oy - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) { dragIdx = best; try { overlay.setPointerCapture(e.pointerId); } catch { /* 合成事件 / 失效指针：靠全局 pointerup 兜底 */ } }
  });
  overlay.addEventListener('pointermove', (e) => {
    if (phase !== 'review') return;
    const r = overlay.getBoundingClientRect();
    const x = (e.clientX - r.left); const y = (e.clientY - r.top);
    if (dragIdx < 0) { overlay.style.cursor = 'default'; return; }
    const disp = displayScale();
    quad[dragIdx] = { x: clamp((x - disp.ox) / disp.k, 0, still.width), y: clamp((y - disp.oy) / disp.k, 0, still.height) };
    schedulePreview();
  });
  const endDrag = () => { dragIdx = -1; };
  doc.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  const renderPages = () => {
    pagesEl.innerHTML = '';
    pages.forEach((p, i) => {
      const chip = doc.createElement('span');
      chip.className = 'scan-page-chip';
      chip.innerHTML = `<b>第 ${i + 1} 页</b><button type="button" aria-label="删除第 ${i + 1} 页">×</button>`;
      chip.querySelector('button').addEventListener('click', () => { pages.splice(i, 1); renderPages(); });
      pagesEl.appendChild(chip);
    });
    btnImg.disabled = !pages.length; btnPdf.disabled = !pages.length;
    if (pages.length) setHint(`已收录 ${pages.length} 页 · 可继续拍摄或导出`);
  };

  const toFile = (source, name, type) => new Promise((res) => {
    if (source.toBlob) source.toBlob((blob) => res(blob && new File([blob], name, { type })), type, 0.92);
    else res(new File([source], name, { type: 'application/pdf' }));
  });

  modal.addEventListener('click', async (e) => {
    const hit = (n) => e.target.closest(`[data-r="${n}"]`);
    const f = e.target.closest('.scan-f');
    if (f) { filter = f.dataset.f; for (const b of modal.querySelectorAll('.scan-f')) b.classList.toggle('on', b === f); schedulePreview(); return; }
    if (hit('close') || hit('cancel')) { finish(null); return; }
    if (hit('shoot')) {
      if (phase === 'live') { captureStill(); toReview(); }
      else {
        pages.push({ canvas: renderPage(still, quad, filter, OUTPUT_EDGE) });
        renderPages();
        toLive();
      }
      return;
    }
    if (hit('reshoot')) { toLive(); return; }
    if (hit('save-img')) {
      const files = [];
      for (let i = 0; i < pages.length; i++) files.push(await toFile(pages[i].canvas, `scan-${String(i + 1).padStart(2, '0')}.png`, 'image/png'));
      finish(files);
      return;
    }
    if (hit('save-pdf')) {
      try {
        const parts = [];
        for (const p of pages) {
          const blob = await new Promise((res) => p.canvas.toBlob((b) => res(b), 'image/jpeg', 0.9));
          if (!blob) throw new Error('页面编码失败');
          parts.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: p.canvas.width, height: p.canvas.height });
        }
        const pdf = jpegPagesToPdf(parts);
        finish([new File([pdf], 'scan.pdf', { type: 'application/pdf' })]);
      } catch (err) {
        setHint(`导出 PDF 失败：${(err && err.message) || err}`);
      }
    }
  });

  win.addEventListener('resize', drawOverlay);
  try {
    await start();
  } catch (err) {
    stop();
    const name = String((err && err.name) || '');
    throw new Error(
      name === 'NotAllowedError' || name === 'SecurityError'
        ? '相机权限被禁用（系统、浏览器设置或 Permissions-Policy）；本地预览服务默认屏蔽相机，GitHub Pages 上可用'
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? '未找到可用摄像头'
          : `摄像头开启失败：${(err && err.message) || err}`,
    );
  }
  return result;
}
