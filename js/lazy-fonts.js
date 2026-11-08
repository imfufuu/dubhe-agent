// Dubhe Agent · 懒加载字体（assets/fonts-lazy/index.css）的筛选与导出嵌入
// 应用内由浏览器按 unicode-range 懒下载；分享导出是单文件 HTML，只嵌入文档实际用到的字符所在分片。

// Latin faces are also embedded when used; the remaining families still use unicode-range subsets.
export const LAZY_FONT_MIN_CODEPOINT = 0x0000;

export function parseRanges(spec) {
  return String(spec || '').split(',').map((seg) => seg.trim()).filter(Boolean).map((seg) => {
    const m = /^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(seg);
    if (!m) return null;
    const lo = parseInt(m[1], 16);
    return [lo, m[2] ? parseInt(m[2], 16) : lo];
  }).filter(Boolean);
}

export function parseFontFaces(css) {
  return [...String(css || '').matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => {
    const block = m[0];
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1] || '';
    const urls = [...block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((u) => u[1]);
    // A face may list a remote primary source plus a bundled fallback. For offline share export
    // always embed the same-origin file — a third-party font host can expire or block CORS.
    const url = urls.find((u) => !/^(?:https?:)?\/\//i.test(u) && !/^data:/i.test(u)) || urls[0] || '';
    return { block, url, urls, ranges: parseRanges(range) };
  }).filter((f) => f.url);
}

// codepoints：数字数组（任意顺序）。只保留与之相交的分片。
export function selectLazyFaces(css, codepoints) {
  const sorted = [...new Set(codepoints)].filter((c) => c >= LAZY_FONT_MIN_CODEPOINT).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const hits = (ranges) => ranges.some(([lo, hi]) => {
    let l = 0, r = sorted.length;
    while (l < r) { const mid = (l + r) >> 1; if (sorted[mid] < lo) l = mid + 1; else r = mid; }
    return l < sorted.length && sorted[l] <= hi;
  });
  return parseFontFaces(css).filter((f) => f.ranges.length && hits(f.ranges));
}

export function codepointsOf(text) {
  const out = new Set();
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0);
    if (c >= LAZY_FONT_MIN_CODEPOINT) out.add(c);
  }
  return [...out];
}
