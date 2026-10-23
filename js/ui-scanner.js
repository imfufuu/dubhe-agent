// ─── 文档扫描（V1.8.1）：摄像头实时取景 → 自动四角检测 → 拖拽微调 → 透视矫正导出 ───
// 只在有摄像头且 Permissions-Policy 允许的环境出现（ui-devices 控制入口按钮可见性）。
// 算法在 js/doc-scanner.js（纯函数）；这里只负责相机、UI 与产出 File[]。
import { detectDocCorners, computeHomography, warpImageData, applyScanFilter, targetSizeForQuad } from './doc-scanner.js';
import { jpegPagesToPdf } from './doc-scanner.js';

const PREVIEW_EDGE = 980;
const OUTPUT_EDGE = 2400;
const DETECT_EDGE = 320;
export const SCANNER_HANDLE_HIT_RADIUS = 46;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Map full-resolution source-image points into the actually displayed canvas rect. */
export function scannerDisplayMetrics(canvasRect, overlayRect, sourceWidth, sourceHeight) {
  const width = Math.max(0, Number(canvasRect?.width) || 0);
  const height = Math.max(0, Number(canvasRect?.height) || 0);
  const sourceW = Math.max(0, Number(sourceWidth) || 0);
  const sourceH = Math.max(0, Number(sourceHeight) || 0);
  return {
    sx: sourceW > 0 ? width / sourceW : 0,
    sy: sourceH > 0 ? height / sourceH : 0,
    ox: (Number(canvasRect?.left) || 0) - (Number(overlayRect?.left) || 0),
    oy: (Number(canvasRect?.top) || 0) - (Number(overlayRect?.top) || 0),
  };
}
export const scannerImageToOverlay = (point, m) => ({ x: point.x * m.sx + m.ox, y: point.y * m.sy + m.oy });
export const scannerOverlayToImage = (point, m) => ({
  x: m.sx ? (point.x - m.ox) / m.sx : 0,
  y: m.sy ? (point.y - m.oy) / m.sy : 0,
});
export function nearestScannerHandle(point, handles, radius = SCANNER_HANDLE_HIT_RADIUS) {
  let best = -1; let bestDistance = radius * radius;
  handles.forEach((handle, index) => {
    const distance = (handle.x - point.x) ** 2 + (handle.y - point.y) ** 2;
    if (distance <= bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}

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
        <div class="photo-stage scan-stage" data-r="stage" data-phase="live">
          <div class="photo-canvas-wrap" data-r="wrap">
            <video class="scan-video" playsinline muted autoplay></video>
            <canvas class="scan-canvas" data-r="canvas" hidden></canvas>
            <canvas class="scan-overlay" data-r="overlay" aria-hidden="true"></canvas>
          </div>
          <aside class="scan-result-card" data-r="result-card" aria-label="校正后的页面预览" hidden>
            <div class="scan-result-head"><strong>校正预览</strong><span>将作为扫描件加入</span></div>
            <canvas class="scan-result-canvas" data-r="result-preview" aria-label="校正后的扫描页面"></canvas>
          </aside>
        </div>
      </div>
      <div class="scan-bar" role="toolbar" aria-label="扫描工具">
        <div class="scan-filters" role="group" aria-label="滤镜">
          <button class="scan-f on" type="button" data-f="original" aria-pressed="true">原色</button><button class="scan-f" type="button" data-f="gray" aria-pressed="false">灰度</button><button class="scan-f" type="button" data-f="mono" aria-pressed="false">黑白</button>
        </div>
        <div class="scan-actions">
          <button class="ghost-btn" type="button" data-r="reshoot" hidden>重新取景</button>
          <button class="primary-btn scan-shutter" type="button" data-r="shoot" disabled>拍摄</button>
          <button class="ghost-btn" type="button" data-r="toggle-preview" aria-expanded="false" hidden>校正预览</button>
        </div>
        <div class="scan-session">
          <span class="scan-count" data-r="count" aria-live="polite">已添加 0 页</span>
          <div class="scan-pages" data-r="pages"></div>
        </div>
      </div>
      <footer class="photo-editor-foot">
        <div class="photo-editor-hint"><span data-r="footer-hint">对准页面后拍摄；支持多页，可导出图片或 PDF。</span></div>
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
  const stage = $('stage');
  const resultCard = $('result-card');
  const resultCanvas = $('result-preview');
  const hint = $('hint');
  const footerHint = $('footer-hint');
  const pageCount = $('count');
  const pagesEl = $('pages');
  const btnImg = $('save-img');
  const btnPdf = $('save-pdf');
  const btnShoot = $('shoot');
  const btnPreview = $('toggle-preview');
  const btnReshoot = $('reshoot');
  requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('open')));

  let stream = null;
  let phase = 'live'; // live | review
  let cameraReady = false;
  let previewShown = false;
  let filter = 'original';
  let still = null;            // 冻结帧 canvas（全分辨率）
  let quad = null;             // 全分辨率坐标的四角
  let preview = null;          // 预览渲染结果 canvas
  const pages = [];            // {canvas, name}
  let raf = 0;

  const setHint = (t, footer = '') => {
    hint.textContent = t;
    if (footerHint && footer) footerHint.textContent = footer;
  };
  const syncCameraReady = () => {
    cameraReady = !!(video.videoWidth && video.videoHeight);
    if (phase === 'live') btnShoot.disabled = !cameraReady;
    if (cameraReady && phase === 'live' && !still) {
      setHint(pages.length ? `已收录 ${pages.length} 页 · 可继续拍摄或导出` : '对准一页文档，尽量让纸面充满画面',
        '对准页面后拍摄；支持多页，可导出图片或 PDF。');
    }
  };
  const syncFilterButtons = () => {
    for (const button of modal.querySelectorAll('.scan-f')) {
      const selected = button.dataset.f === filter;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = phase !== 'review';
    }
  };
  const syncPreviewPanel = () => {
    const show = phase === 'review' && previewShown;
    resultCard.hidden = !show;
    if (stage) stage.dataset.preview = show ? 'open' : 'closed';
    btnPreview.hidden = phase !== 'review';
    btnPreview.disabled = phase !== 'review';
    btnPreview.setAttribute('aria-expanded', String(show));
    btnPreview.textContent = show ? '隐藏预览' : '校正预览';
  };
  video.addEventListener('loadedmetadata', syncCameraReady);
  video.addEventListener('playing', syncCameraReady);
  video.addEventListener('resize', syncCameraReady);
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
    syncCameraReady();
    if (!cameraReady) setHint('摄像头已连接，正在等待画面…', '请保持此窗口打开；画面就绪后即可拍摄。');
  };

  const stop = () => {
    raf && cancelAnimationFrame(raf); raf = 0;
    if (stream) for (const t of stream.getTracks()) { try { t.stop(); } catch { /* 已停止 */ } }
    stream = null;
    modal.classList.add('closing');
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerup', endDrag);
    win.removeEventListener('resize', drawOverlay);
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
    if (phase === 'live' || !quad || !still) return;
    const disp = displayScale();
    if (!disp.sx || !disp.sy) return;
    const pts = quad.map((p) => scannerImageToOverlay(p, disp));
    g.lineWidth = 2; g.strokeStyle = '#a78bfa'; g.fillStyle = 'rgba(167,139,250,.16)';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath(); g.fill(); g.stroke();
    pts.forEach((p, index) => {
      const active = index === dragIdx; const hovered = index === hoverIdx;
      if (active || hovered) {
        g.beginPath(); g.arc(p.x, p.y, active ? 25 : 21, 0, Math.PI * 2);
        g.fillStyle = active ? 'rgba(124,58,237,.2)' : 'rgba(124,58,237,.12)'; g.fill();
      }
      g.beginPath(); g.arc(p.x, p.y, active ? 16 : hovered ? 14 : 12, 0, Math.PI * 2);
      g.lineWidth = active ? 3 : 2; g.strokeStyle = '#5b21b6'; g.fillStyle = '#fff'; g.fill(); g.stroke();
      g.beginPath(); g.arc(p.x, p.y, active ? 9 : hovered ? 8 : 6.5, 0, Math.PI * 2);
      g.fillStyle = active ? '#6d28d9' : '#8b5cf6'; g.fill();
      if (active) { g.beginPath(); g.arc(p.x, p.y, 2.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
    });
  };

  function displayScale() {
    // quad 始终用冻结原图的全分辨率坐标；画布显示尺寸可以独立缩放。
    const wr = overlay.parentElement.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    if (!still || !cr.width || !cr.height) return { sx: 0, sy: 0, ox: 0, oy: 0 };
    return scannerDisplayMetrics(cr, wr, still.width, still.height);
  }

  const renderPreview = () => {
    if (!still || !quad) return;
    if (previewShown) {
      preview = renderPage(still, quad, filter, PREVIEW_EDGE);
      const resultCtx = resultCanvas.getContext('2d');
      resultCanvas.width = preview.width; resultCanvas.height = preview.height;
      resultCtx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
      resultCtx.drawImage(preview, 0, 0);
    } else preview = null;

    // 主画布显示完整原图（而不是已透视裁出的结果），定位点因此与背景始终共用坐标系。
    const sourceSize = scaleToFit(still.width, still.height, PREVIEW_EDGE);
    canvas.width = sourceSize.width; canvas.height = sourceSize.height;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.drawImage(still, 0, 0, canvas.width, canvas.height);
    const sourceData = applyScanFilter(c.getImageData(0, 0, canvas.width, canvas.height), filter);
    const filteredData = c.createImageData(sourceData.width, sourceData.height);
    filteredData.data.set(sourceData.data);
    c.putImageData(filteredData, 0, 0);
    drawOverlay();
  };
  const schedulePreview = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; renderPreview(); }); };

  const captureStill = () => {
    const vw = video.videoWidth; const vh = video.videoHeight;
    if (!vw || !vh) return false;
    const fit = scaleToFit(vw, vh, OUTPUT_EDGE);
    still = doc.createElement('canvas');
    still.width = fit.width; still.height = fit.height;
    still.getContext('2d').drawImage(video, 0, 0, fit.width, fit.height);
    quad = detectQuadOnStill();
    return true;
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
    if (stage) stage.dataset.phase = 'live';
    video.hidden = false; canvas.hidden = true; still = null; quad = null; preview = null;
    previewShown = false; syncPreviewPanel();
    btnShoot.textContent = '拍摄';
    btnShoot.disabled = !cameraReady;
    btnReshoot.hidden = true;
    syncFilterButtons();
    const nextHint = pages.length ? `已收录 ${pages.length} 页 · 可继续拍摄或导出` : '对准一页文档，尽量让纸面充满画面';
    setHint(nextHint, pages.length ? '可继续拍下一页，也可移除页面后导出图片或 PDF。' : '对准页面后拍摄；支持多页，可导出图片或 PDF。');
    drawOverlay();
  };
  const toReview = () => {
    phase = 'review';
    if (stage) stage.dataset.phase = 'review';
    video.hidden = true; canvas.hidden = false;
    previewShown = false; syncPreviewPanel();
    btnShoot.textContent = `加入第 ${pages.length + 1} 页`;
    btnShoot.disabled = false;
    btnReshoot.hidden = false;
    syncFilterButtons();
    setHint(`第 ${pages.length + 1} 页 · 拖动四个定位点微调范围`, '可点“校正预览”查看裁切效果；确认后加入这一页。');
    renderPreview();
  };

  // 指针拖角：视觉标记随 hover / drag 放大，命中半径按 CSS 像素扩大到 46px。
  let dragIdx = -1; let hoverIdx = -1;
  overlay.addEventListener('pointerdown', (e) => {
    if (phase !== 'review') return;
    const r = overlay.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    const disp = displayScale();
    if (!disp.sx || !disp.sy) return;
    const handles = quad.map((p) => scannerImageToOverlay(p, disp));
    const best = nearestScannerHandle({ x, y }, handles);
    if (best >= 0) {
      dragIdx = best; hoverIdx = best; overlay.style.cursor = 'grabbing'; e.preventDefault(); drawOverlay();
      try { overlay.setPointerCapture(e.pointerId); } catch { /* 合成事件 / 失效指针：靠全局 pointerup 兜底 */ }
    }
  });
  overlay.addEventListener('pointermove', (e) => {
    if (phase !== 'review') return;
    const r = overlay.getBoundingClientRect();
    const x = e.clientX - r.left; const y = e.clientY - r.top;
    const disp = displayScale();
    if (!disp.sx || !disp.sy) { overlay.style.cursor = 'default'; return; }
    if (dragIdx < 0) {
      const nextHover = nearestScannerHandle({ x, y }, quad.map((p) => scannerImageToOverlay(p, disp)));
      overlay.style.cursor = nextHover >= 0 ? 'grab' : 'default';
      if (nextHover !== hoverIdx) { hoverIdx = nextHover; drawOverlay(); }
      return;
    }
    overlay.style.cursor = 'grabbing';
    const source = scannerOverlayToImage({ x, y }, disp);
    quad[dragIdx] = { x: clamp(source.x, 0, still.width), y: clamp(source.y, 0, still.height) };
    schedulePreview();
  });
  const endDrag = () => {
    const wasActive = dragIdx >= 0;
    dragIdx = -1; hoverIdx = -1; overlay.style.cursor = 'default';
    if (wasActive) drawOverlay();
  };
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
    if (pageCount) pageCount.textContent = `已添加 ${pages.length} 页`;
    if (phase === 'live') {
      setHint(pages.length ? `已收录 ${pages.length} 页 · 可继续拍摄或导出` : '对准一页文档，尽量让纸面充满画面',
        pages.length ? '可继续拍下一页，也可移除页面后导出图片或 PDF。' : '对准页面后拍摄；支持多页，可导出图片或 PDF。');
    }
  };

  const toFile = (source, name, type) => new Promise((res) => {
    if (source.toBlob) source.toBlob((blob) => res(blob && new File([blob], name, { type })), type, 0.92);
    else res(new File([source], name, { type: 'application/pdf' }));
  });

  modal.addEventListener('click', async (e) => {
    const hit = (n) => e.target.closest(`[data-r="${n}"]`);
    const f = e.target.closest('.scan-f');
    if (f && phase === 'review') { filter = f.dataset.f; syncFilterButtons(); schedulePreview(); return; }
    if (hit('toggle-preview') && phase === 'review') {
      previewShown = !previewShown;
      syncPreviewPanel();
      requestAnimationFrame(() => { if (previewShown) renderPreview(); else drawOverlay(); });
      return;
    }
    if (hit('close') || hit('cancel')) { finish(null); return; }
    if (hit('shoot')) {
      if (phase === 'live') {
        if (!cameraReady || !captureStill()) {
          syncCameraReady();
          setHint('摄像头画面尚未就绪，请稍候再拍。', '画面就绪后“拍摄”按钮会自动启用。');
          return;
        }
        toReview();
      } else {
        try {
          pages.push({ canvas: renderPage(still, quad, filter, OUTPUT_EDGE) });
          renderPages();
          toLive();
        } catch (err) {
          setHint(`页面处理失败：${(err && err.message) || err}`, '可重新取景后再试；已收录的页面不会丢失。');
        }
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
  syncFilterButtons();
  syncPreviewPanel();
  syncCameraReady();
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
