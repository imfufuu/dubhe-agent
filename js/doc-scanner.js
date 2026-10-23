// ─── 文档扫描核心算法（V1.8.1 新增；纯函数，可在 node 里单测）────────────────────────
// 透视矫正：灰度 / Otsu 双极性分割 → 8 邻接连通域 → 凸包四角简化。
// 检测失败就退回整幅（用户仍可拖角点手动框）。增亮/灰度/局部自适应二值滤镜；多页合成一个
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

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const polygonArea = (points) => Math.abs(points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y;
}, 0)) / 2;

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 4) return sorted;
  const lower = []; const upper = [];
  for (const p of sorted) {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function reduceHullToQuad(hull) {
  const points = hull.slice();
  // Peel the least-convex boundary points first. Flat-edge noise disappears before the
  // four actual page corners, unlike x+y extrema which can select the wrong edge pixel.
  while (points.length > 4) {
    let removeAt = 0; let smallest = Infinity;
    for (let i = 0; i < points.length; i++) {
      const area = Math.abs(cross(points[(i + points.length - 1) % points.length], points[i], points[(i + 1) % points.length]));
      if (area < smallest) { smallest = area; removeAt = i; }
    }
    points.splice(removeAt, 1);
  }
  const center = points.reduce((sum, p) => ({ x: sum.x + p.x / points.length, y: sum.y + p.y / points.length }), { x: 0, y: 0 });
  const ordered = points.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  let start = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i].x + ordered[i].y < ordered[start].x + ordered[start].y) start = i;
  const rotated = ordered.slice(start).concat(ordered.slice(0, start));
  // y grows down the screen; positive shoelace order is TL → TR → BR → BL.
  const signed = rotated.reduce((sum, p, i) => {
    const q = rotated[(i + 1) % rotated.length]; return sum + p.x * q.y - q.x * p.y;
  }, 0);
  return signed < 0 ? [rotated[0], ...rotated.slice(1).reverse()] : rotated;
}

function fitBoundaryLine(start, end, boundary) {
  const dx = end.x - start.x; const dy = end.y - start.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 4) return null;
  const length = Math.sqrt(lengthSquared); const points = [];
  for (const p of boundary) {
    const along = ((p.x - start.x) * dx + (p.y - start.y) * dy) / lengthSquared;
    if (along < 0.08 || along > 0.92) continue;
    const offset = Math.abs(dx * (p.y - start.y) - dy * (p.x - start.x)) / length;
    if (offset <= 3) points.push(p);
  }
  if (points.length < Math.max(8, length * 0.16)) return null;
  let mx = 0; let my = 0;
  for (const p of points) { mx += p.x / points.length; my += p.y / points.length; }
  let xx = 0; let xy = 0; let yy = 0;
  for (const p of points) { const x = p.x - mx; const y = p.y - my; xx += x * x; xy += x * y; yy += y * y; }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const nx = -Math.sin(angle); const ny = Math.cos(angle);
  return { a: nx, b: ny, c: -(nx * mx + ny * my) };
}

function refineQuadFromBoundary(quad, boundary, width, height) {
  const lines = quad.map((point, i) => fitBoundaryLine(point, quad[(i + 1) % 4], boundary));
  if (lines.some((line) => !line)) return quad;
  const refined = [];
  for (let i = 0; i < 4; i++) {
    const previous = lines[(i + 3) % 4]; const next = lines[i];
    const determinant = previous.a * next.b - next.a * previous.b;
    if (Math.abs(determinant) < 0.12) return quad;
    const x = (next.b * previous.c - previous.b * next.c) / determinant;
    const y = (next.a * previous.c - previous.a * next.c) / determinant;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -3 || y < -3 || x > width + 3 || y > height + 3) return quad;
    refined.push({ x: Math.max(0, Math.min(width - 1, x)), y: Math.max(0, Math.min(height - 1, y)) });
  }
  return polygonArea(refined) > width * height * 0.12 ? refined : quad;
}

function bestQuadFromMask(mask, width, height, brightPolarity = false) {
  const total = width * height; const seen = new Uint8Array(total); const queue = new Int32Array(total);
  let best = null;
  for (let seed = 0; seed < total; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0; let tail = 0; let left = false; let right = false; let top = false; let bottom = false;
    queue[tail++] = seed; seen[seed] = 1;
    // 8-connected labeling keeps a page together despite one-pixel threshold gaps.
    while (head < tail) {
      const p = queue[head++]; const x = p % width; const y = (p / width) | 0;
      if (x === 0) left = true; if (x === width - 1) right = true;
      if (y === 0) top = true; if (y === height - 1) bottom = true;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx; if (nx < 0 || nx >= width) continue;
          const q = ny * width + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
        }
      }
    }
    const areaRatio = tail / total;
    const borderEdges = Number(left) + Number(right) + Number(top) + Number(bottom);
    // A large connected backdrop usually reaches three or four frame edges; don't mistake it for paper.
    if (areaRatio < 0.12 || areaRatio > 0.94 || borderEdges >= 3) continue;
    const boundary = [];
    for (let i = 0; i < tail; i++) {
      const p = queue[i]; const x = p % width; const y = (p / width) | 0;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1
          || !mask[p - 1] || !mask[p + 1] || !mask[p - width] || !mask[p + width]) boundary.push({ x, y });
    }
    const hull = convexHull(boundary);
    if (hull.length < 4) continue;
    const hullArea = polygonArea(hull);
    if (hullArea < total * 0.12) continue;
    let quad = reduceHullToQuad(hull);
    quad = refineQuadFromBoundary(quad, boundary, width, height);
    const wide = Math.min(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
    const tall = Math.min(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
    const quadArea = polygonArea(quad);
    if (wide < width * 0.25 || tall < height * 0.25 || quadArea < total * 0.12) continue;
    const fill = Math.min(1, tail / Math.max(1, hullArea));
    const borderFactor = borderEdges === 2 ? 0.72 : borderEdges === 1 ? 0.88 : 1;
    const polarityFactor = brightPolarity ? 1.04 : 1;
    const score = areaRatio * (0.7 + 0.3 * fill) * borderFactor * polarityFactor;
    if (!best || score > best.score) best = { quad, score };
  }
  return best;
}

/** 找文档四边形。返回 [{x,y}×4 顺次 左上/右上/右下/左下] 或 null。 */
export function detectDocCorners(imageData) {
  const { width: w, height: h } = imageData;
  if (w < 16 || h < 16 || !imageData?.data || imageData.data.length < w * h * 4) return null;
  const gray = grayOf(imageData);
  let min = 255; let max = 0;
  for (let i = 0; i < gray.length; i++) { if (gray[i] < min) min = gray[i]; if (gray[i] > max) max = gray[i]; }
  if (max - min < 18) return null; // 对比不足：不硬猜
  const threshold = otsuThreshold(gray);
  const brightMask = new Uint8Array(gray.length); const darkMask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    brightMask[i] = gray[i] > threshold ? 1 : 0;
    darkMask[i] = gray[i] <= threshold ? 1 : 0;
  }
  const candidates = [bestQuadFromMask(brightMask, w, h, true), bestQuadFromMask(darkMask, w, h, false)].filter(Boolean);
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].quad;
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
    const stride = w + 1;
    const ii = new Float64Array(stride * (h + 1));
    const squareIi = new Float64Array(stride * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0; let rowSquares = 0;
      for (let x = 0; x < w; x++) {
        const value = gray[y * w + x]; row += value; rowSquares += value * value;
        const at = (y + 1) * stride + x + 1;
        ii[at] = ii[y * stride + x + 1] + row;
        squareIi[at] = squareIi[y * stride + x + 1] + rowSquares;
      }
    }
    const box = Math.max(10, Math.min(64, Math.round(Math.min(w, h) / 32)));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - box); const y0 = Math.max(0, y - box);
        const x1 = Math.min(w, x + box + 1); const y1 = Math.min(h, y + box + 1);
        const n = (x1 - x0) * (y1 - y0);
        const a = y0 * stride + x0; const b = y0 * stride + x1;
        const c = y1 * stride + x0; const e = y1 * stride + x1;
        const sum = ii[e] - ii[b] - ii[c] + ii[a];
        const sumSquares = squareIi[e] - squareIi[b] - squareIi[c] + squareIi[a];
        const mean = sum / n;
        const deviation = Math.sqrt(Math.max(0, sumSquares / n - mean * mean));
        // Local mean adapts to illumination; a small bounded offset keeps faint antialiased
        // strokes on the dark side without turning paper texture into heavy black noise.
        const offset = Math.max(4, Math.min(16, deviation * 0.12));
        const threshold = mean - offset;
        const v = gray[y * w + x] > threshold ? 255 : 0;
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
