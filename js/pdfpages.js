// PDF → 页图。新文件，避免给 pdf.js / ui.js 混版缓存加新导出。
// 按需加载 assets/pdfjs/（Mozilla pdf.js 3.11，主线程 + 同源 worker）。

const MAX_PAGES = 8;
const BASE_SCALE = 2.4;       // 提高栅格精度，方便 OCR / 读表
const JPEG_QUALITY = 0.92;
const MAX_EDGE = 4096;        // 单边像素上限，避免超大 Canvas 撑爆内存

function toU8(bytes) {
  if (!bytes) return new Uint8Array(0);
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Uint8Array(0);
}

let loading;
function loadPdfjs() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (loading) return loading;
  const ver = (document.querySelector('meta[name="app-version"]') || {}).content || '';
  const q = ver ? `?v=${encodeURIComponent(ver)}` : '';
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `assets/pdfjs/pdf.min.js${q}`;
    s.async = true;
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) { reject(new Error('pdf.js 未挂载')); return; }
      lib.GlobalWorkerOptions.workerSrc = `assets/pdfjs/pdf.worker.min.js${q}`;
      resolve(lib);
    };
    s.onerror = () => reject(new Error('无法加载 PDF 渲染库'));
    document.head.appendChild(s);
  });
  return loading;
}

function pageName(pdfName, i) {
  const n = String(pdfName || 'document.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || 'document.pdf';
  const stem = n.replace(/\.pdf$/i, '') || 'document';
  return `${stem}-p${String(i).padStart(2, '0')}.jpg`;
}

/**
 * 把 PDF 每一页画成 JPEG data URL，供 analyze_image 识别。
 * @returns {Promise<{ok:boolean, pages:number, images:{name:string, dataUrl:string, page:number}[], error?:string, truncated?:boolean}>}
 */
export async function pdfToImages(bytes, { maxPages = MAX_PAGES, name = 'document.pdf', baseScale = BASE_SCALE, maxEdge = MAX_EDGE, quality = JPEG_QUALITY, firstPage = 1 } = {}) {
  const u8 = toU8(bytes);
  if (u8.length < 5 || u8[0] !== 0x25 || u8[1] !== 0x50 || u8[2] !== 0x44 || u8[3] !== 0x46) {
    return { ok: false, pages: 0, images: [], error: '不是 PDF 文件' };
  }
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return { ok: false, pages: 0, images: [], error: 'PDF 转图片需要浏览器 Canvas' };
  }
  let pdfjs;
  try { pdfjs = await loadPdfjs(); }
  catch (err) { return { ok: false, pages: 0, images: [], error: err.message || String(err) }; }
  if (!pdfjs) return { ok: false, pages: 0, images: [], error: 'PDF 渲染库不可用' };

  let doc;
  try {
    const data = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  } catch (err) {
    return { ok: false, pages: 0, images: [], error: `无法打开 PDF（可能加密或损坏）：${err.message || err}` };
  }
  const pages = doc.numPages || 0;
  const start = Math.max(1, Math.min(pages, Number(firstPage) || 1));
  const n = Math.min(pages, start + maxPages - 1);
  const images = [];
  try {
    for (let i = start; i <= n; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(window.devicePixelRatio, 2.5) : 1;
      let scale = baseScale * dpr;
      const edge = Math.max(base.width, base.height) * scale;
      if (edge > maxEdge) scale *= maxEdge / edge;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return { ok: false, pages, images, error: 'Canvas 不可用' };
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      canvas.width = 0; canvas.height = 0; // 立即释放位图内存（多页连续渲染时很关键）
      images.push({ name: pageName(name, i), dataUrl, page: i });
    }
  } catch (err) {
    return { ok: false, pages, images, error: `渲染 PDF 第 ${images.length + 1} 页失败：${err.message || err}` };
  } finally {
    try { if (doc && doc.destroy) doc.destroy(); } catch { /* */ }
  }
  if (!images.length) return { ok: false, pages, images: [], error: '没有渲染出任何页' };
  return { ok: true, pages, images, truncated: pages > n };
}

/**
 * 用 pdf.js 文本层提取每页内嵌文字（电子版 PDF 几乎零成本拿到全文；扫描件会是空的）。
 * @returns {Promise<{ok:boolean, pages:number, texts:string[], chars:number, error?:string}>}
 */
export async function pdfExtractText(bytes, { maxPages = 50, maxChars = 120000 } = {}) {
  const u8 = toU8(bytes);
  if (u8.length < 5 || u8[0] !== 0x25 || u8[1] !== 0x50 || u8[2] !== 0x44 || u8[3] !== 0x46) {
    return { ok: false, pages: 0, texts: [], chars: 0, error: '不是 PDF 文件' };
  }
  let pdfjs;
  try { pdfjs = await loadPdfjs(); }
  catch (err) { return { ok: false, pages: 0, texts: [], chars: 0, error: err.message || String(err) }; }
  if (!pdfjs) return { ok: false, pages: 0, texts: [], chars: 0, error: 'PDF 渲染库不可用' };
  let doc;
  try {
    const data = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  } catch (err) {
    return { ok: false, pages: 0, texts: [], chars: 0, error: `无法打开 PDF（可能加密或损坏）：${err.message || err}` };
  }
  const pages = doc.numPages || 0;
  const n = Math.min(pages, maxPages);
  const texts = [];
  let chars = 0;
  try {
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = layoutPdfText(content.items || [], content.styles || {});
      if (chars + text.length > maxChars) { text = text.slice(0, Math.max(0, maxChars - chars)) + '\n…[文本层过长，已截断]'; texts.push(text); chars += text.length; break; }
      chars += text.length;
      texts.push(text);
    }
  } catch (err) {
    return { ok: texts.length > 0, pages, texts, chars, error: `读取第 ${texts.length + 1} 页文本失败：${err.message || err}` };
  } finally {
    try { if (doc && doc.destroy) doc.destroy(); } catch { /* */ }
  }
  return { ok: true, pages, texts, chars };
}

// ── 文本层排版（纯函数，可脱离 pdf.js 测试）──
// 目标：让 TeX 排版的 PDF 尽量保留可读的公式结构，而不是把上下标拆成独立的行、把符号和字母粘成一团。
//  · 行：按基线 y 分行；上下标（字号明显变小、基线偏移）留在原行内，不另起一行；
//  · 间距：水平间隙超过字号 15% 时补一个空格（pdf.js 的文本项常常不带空格）；
//  · 上下标：同一方向的连续上（下）标合并为 ^{…}（_{…}）；
//  · 数学：数学字体（CMMI / CMSY / CMEX / MSAM / MSBM / STIX / Symbol 等）与上下标组成的连续片段包成 $…$。
const MATH_FONT_RE = /CMMI|CMSY|CMEX|MSAM|MSBM|STIX|Math|Symbol/i;

export function layoutPdfText(items, styles = {}) {
  const lines = [];
  let cur = null; // { base, size, toks: [{ text, math, script, gapBefore }] }
  let prevEnd = null;
  const flush = () => { if (cur) { lines.push(renderPdfLine(cur)); cur = null; prevEnd = null; } };
  for (const item of items) {
    if (!item) continue;
    const str = typeof item.str === 'string' ? item.str : '';
    const tr = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(tr[4]);
    const y = Number(tr[5]);
    const size = Math.max(1, Number(item.height) || Math.abs(Number(tr[3])) || Math.abs(Number(tr[0])) || 10);
    const width = Number(item.width) || 0;
    const family = String((styles[item.fontName] && styles[item.fontName].fontFamily) || item.fontName || '');
    const math = MATH_FONT_RE.test(family);
    if (str) {
      if (!cur) {
        cur = { base: y, size, toks: [] };
      } else {
        const dy = y - cur.base;
        const absDy = Math.abs(dy);
        const isScript = size < 0.85 * cur.size && absDy > 0.1 * cur.size && absDy < 0.9 * cur.size;
        if (!isScript && absDy > Math.max(2, 0.5 * cur.size)) { flush(); cur = { base: y, size, toks: [] }; }
        if (cur && isScript) {
          cur.toks.push({ text: str, math: true, script: dy > 0 ? '^' : '_', gapBefore: false });
          prevEnd = Number.isFinite(x) ? x + width : null;
          if (item.hasEOL) cur.toks.push({ text: '\n', math: false, script: null, gapBefore: false });
          continue;
        }
      }
      const gap = prevEnd != null && Number.isFinite(x) ? x - prevEnd : 0;
      const needSpace = prevEnd != null && gap > 0.15 * cur.size && !/^\s/.test(str);
      if (needSpace) cur.toks.push({ text: ' ', math: false, script: null, gapBefore: true });
      cur.toks.push({ text: str, math, script: null, gapBefore: false });
      prevEnd = Number.isFinite(x) ? x + width : null;
    }
    if (item.hasEOL) { flush(); }
  }
  flush();
  return lines.filter((l) => l.trim()).join('\n');
}

// 把一行的文本项渲染为文本（数学片段包进 $…$，上下标用 ^{…} / _{…}）
function renderPdfLine(line) {
  const out = [];
  let mathRun = null; // 当前数学片段的字符串数组
  const endMath = () => {
    if (!mathRun) return;
    const body = mathRun.join('').replace(/\s+/g, ' ').trim();
    if (body) out.push('$' + body + '$');
    mathRun = null;
  };
  let i = 0;
  const toks = line.toks.filter((t) => t.text !== undefined);
  while (i < toks.length) {
    const t = toks[i];
    if (t.script) {
      // 合并同方向的连续上 / 下标
      let j = i; let acc = '';
      while (j < toks.length && toks[j].script === t.script) { acc += toks[j].text; j++; }
      if (!mathRun) mathRun = [];
      mathRun.push(t.script + '{' + acc.trim() + '}');
      i = j;
      continue;
    }
    if (t.math) {
      if (!mathRun) mathRun = [];
      mathRun.push(t.text);
      i++;
      continue;
    }
    if (t.text === ' ' && mathRun) { mathRun.push(' '); i++; continue; }
    endMath();
    out.push(t.text);
    i++;
  }
  endMath();
  return out.join('').replace(/[ \t]+/g, (m) => (m.length > 1 ? ' ' : m)).replace(/\s+$/g, '');
}
