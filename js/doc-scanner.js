// ─── 文档扫描核心算法（V1.8.1 新增；纯函数，可在 node 里单测）────────────────────────
// 透视矫正的四步：灰度 → Otsu 二值化 → 最大连通域 → 四角点（x+y / x−y 极值）。
// 检测失败就退回整幅（用户仍可拖角点手动框）。增亮/灰度/二值三个滤镜；多页合成一个
// 极简 JPEG-in-PDF（DCTDecode，逐字节可校验），不引入任何库。
export function grayOf(imageData) {
  const { width: w, height: h, data } = imageData;
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  return g;
}

export function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0; let wB = 0; let best = 0; let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB; const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/** 找文档四边形。返回 [{x,y}×4 顺次 左上/右上/右下/左下] 或 null。 */
export function detectDocCorners(imageData) {
  const { width: w, height: h } = imageData;
  if (w < 16 || h < 16) return null;
  const gray = grayOf(imageData);
  const thr = otsuThreshold(gray);
  const mask = new Uint8Array(w * h);
  let bright = 0;
  for (let i = 0; i < gray.length; i++) { mask[i] = gray[i] > thr ? 1 : 0; bright += mask[i]; }
  const ratio = bright / gray.length;
  if (ratio > 0.95 || ratio < 0.05) return null; // 对比不足：不硬猜
  if (ratio > 0.8) for (let i = 0; i < mask.length; i++) mask[i] ^= 1; // 纸占满画面时改用暗侧
  // 最大连通域（BFS，行扫描起点）
  const label = new Int32Array(w * h).fill(-1);
  let bestId = -1; let bestSize = 0; let id = 0;
  const stack = new Int32Array(w * h);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] >= 0) continue;
    const cur = id++;
    let top = 0; let size = 0;
    stack[top++] = s; label[s] = cur;
    while (top > 0) {
      const p = stack[--top]; size++;
      const x = p % w;
      if (x > 0 && mask[p - 1] && label[p - 1] < 0) { label[p - 1] = cur; stack[top++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && label[p + 1] < 0) { label[p + 1] = cur; stack[top++] = p + 1; }
      if (p >= w && mask[p - w] && label[p - w] < 0) { label[p - w] = cur; stack[top++] = p - w; }
      if (p < mask.length - w && mask[p + w] && label[p + w] < 0) { label[p + w] = cur; stack[top++] = p + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = cur; }
  }
  if (bestId < 0 || bestSize < w * h * 0.12) return null;
  let tl = -1; let tr = -1; let br = -1; let bl = -1;
  let vTl = Infinity; let vTr = -Infinity; let vBr = -Infinity; let vBl = Infinity;
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestId) continue;
    const x = p % w; const y = (p / w) | 0;
    const s1 = x + y; const s2 = x - y;
    if (s1 < vTl) { vTl = s1; tl = p; }
    if (s2 > vTr) { vTr = s2; tr = p; }
    if (s1 > vBr) { vBr = s1; br = p; }
    if (s2 < vBl) { vBl = s2; bl = p; }
  }
  const pt = (p) => ({ x: p % w, y: (p / w) | 0 });
  const quad = [pt(tl), pt(tr), pt(br), pt(bl)];
  // 退化四边形（太窄/太扁）宁可不给
  const wide = Math.min(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const tall = Math.min(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  if (wide < w * 0.25 || tall < h * 0.25) return null;
  return quad;
}

export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/** 单应变换：把单位矩形（输出）映射到 src 四边形（输入）。返回 3×3 row-major。 */
export function computeHomography(quad, outW, outH) {
  // 解 A·h = b：对 4 组 (dst→src) 对应建 8×8
  const dstPts = [[0, 0], [outW, 0], [outW, outH], [0, outH]];
  const rows = []; const rhs = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = dstPts[i]; const [x, y] = [quad[i].x, quad[i].y];
    rows.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]); rhs.push(x);
    rows.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]); rhs.push(y);
  }
  const A = rows.map((r, i) => [...r, rhs[i]]);
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r2 = c + 1; r2 < 8; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[piv][c])) piv = r2;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r2 = 0; r2 < 8; r2++) {
      if (r2 === c) continue;
      const f = A[r2][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r2][k] -= f * A[c][k];
    }
  }
  const h = A.map((r, i) => r[8] / r[i]); // h[8]=1
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 双线性反向映射。输出 RGBA ImageData 形状的对象。 */
export function warpImageData(src, H, outW, outH) {
  const data = new Uint8ClampedArray(outW * outH * 4);
  const sd = src.data; const sw = src.width; const sh = src.height;
  if (!H) { // 无有效单应：整幅居中拷贝
    const w2 = Math.min(outW, sw); const h2 = Math.min(outH, sh);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const si = (y * sw + x) * 4; const di = (y * outW + x) * 4;
      data[di] = sd[si]; data[di + 1] = sd[si + 1]; data[di + 2] = sd[si + 2]; data[di + 3] = 255;
    }
    return { width: outW, height: outH, data };
  }
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = H[6] * x + H[7] * y + H[8];
      const u = (H[0] * x + H[1] * y + H[2]) / den;
      const v = (H[3] * x + H[4] * y + H[5]) / den;
      const di = (y * outW + x) * 4;
      if (u < 0 || v < 0 || u > sw - 1 || v > sh - 1) { data[di] = 255; data[di + 1] = 255; data[di + 2] = 255; data[di + 3] = 255; continue; }
      const u0 = u | 0; const v0 = v | 0; const fu = u - u0; const fv = v - v0;
      for (let c = 0; c < 3; c++) {
        const a = sd[(v0 * sw + u0) * 4 + c]; const b = sd[(v0 * sw + u0 + 1) * 4 + c];
        const e = sd[((v0 + 1) * sw + u0) * 4 + c]; const f = sd[((v0 + 1) * sw + u0 + 1) * 4 + c];
        data[di + c] = (a * (1 - fu) + b * fu) * (1 - fv) + (e * (1 - fu) + f * fu) * fv;
      }
      data[di + 3] = 255;
    }
  }
  return { width: outW, height: outH, data };
}

/** mode: original（白点对齐增强）/ gray（灰度增强）/ mono（自适应二值） */
export function applyScanFilter(img, mode = 'original') {
  const out = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const d = out.data;
  if (mode === 'original' || mode === 'gray') {
    // 白点 = 亮度 96 分位，按此拉白 + 轻微对比
    const step = Math.max(1, Math.floor((d.length / 4) / 20000) * 4);
    const lum = [];
    for (let i = 0; i < d.length; i += step) lum.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    lum.sort((a, b) => a - b);
    const white = lum[Math.floor(lum.length * 0.96)] || 235;
    const gain = white > 30 ? Math.min(2.2, 255 / white) : 1.1;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] * gain; let g = d[i + 1] * gain; let b = d[i + 2] * gain;
      if (mode === 'gray') { const y = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = y; }
      d[i] = r > 255 ? 255 : r; d[i + 1] = g > 255 ? 255 : g; d[i + 2] = b > 255 ? 255 : b;
    }
    return out;
  }
  if (mode === 'mono') {
    const w = out.width; const h = out.height;
    const gray = new Float64Array(w * h);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += gray[y * w + x]; ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row; }
    }
    const box = Math.max(8, Math.min(64, Math.round(w / 24)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - box); const y0 = Math.max(0, y - box);
        const x1 = Math.min(w, x + box + 1); const y1 = Math.min(h, y + box + 1);
        const n = (x1 - x0) * (y1 - y0);
        const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
        const t = (sum / n) * 0.82;
        const v = gray[y * w + x] > t ? 255 : 0;
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
    return out;
  }
  return out;
}

export function targetSizeForQuad(quad, maxEdge = 2400) {
  const w = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const h = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const scale = Math.max(w, h) > maxEdge ? maxEdge / Math.max(w, h) : 1;
  return { width: Math.max(64, Math.round(w * scale)), height: Math.max(64, Math.round(h * scale)) };
}

// ── 极简 JPEG-in-PDF（多页扫描件合并导出；无外部依赖）───────────────────────────────
const latin1 = (str) => { const b = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff; return b; };
export function jpegPagesToPdf(pages) {
  // pages: [{ bytes, width, height }]（bytes 为 JPEG 原始字节）
  if (!Array.isArray(pages) || !pages.length) throw new Error('没有可导出的页');
  const chunks = []; const offsets = []; let pos = 0;
  const push = (b) => { const u = typeof b === 'string' ? latin1(b) : b; chunks.push(u); pos += u.length; };
  // 对象编号：1 Catalog，2 Pages，每页 3 个（Page / Image / Contents）
  const ids = pages.map((_, i) => ({ page: 3 + i * 3, img: 4 + i * 3, cont: 5 + i * 3 }));
  const objCount = 2 + pages.length * 3;
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const objAt = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };
  objAt(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  objAt(2, `<< /Type /Pages /Count ${pages.length} /Kids [${ids.map((o) => `${o.page} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const o = ids[i];
    const w = Math.round(p.width); const h = Math.round(p.height);
    objAt(o.page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${o.img} 0 R >> >> /Contents ${o.cont} 0 R >>`);
    offsets[o.img] = pos;
    push(`${o.img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`);
    push(p.bytes);
    push('\nendstream\nendobj\n');
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    objAt(o.cont, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const xrefAt = pos;
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let n = 1; n < objCount; n++) xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
