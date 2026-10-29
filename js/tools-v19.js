// ─── V1.9 新增工具的纯函数内核 ─────────────────────────────────────────────
// patch_apply：把 unified diff 应用到沙箱文件（严格校验，任何一个 hunk 不匹配则整体拒绝，不产生半成品）
// dom_inspect：不启动浏览器，对沙箱 HTML 做静态结构检查
// chart_render：把 CSV 的一列标签 + 一列数值渲染为 SVG 柱状图 / 折线图
// 只依赖 DOMParser（浏览器与 jsdom 都有），不接触文件系统；文件读写由 tools.js 负责。

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedPatch(patchText) {
  const lines = String(patchText ?? '').replace(/\r\n/g, '\n').split('\n');
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    const m = HUNK_RE.exec(line);
    if (m) {
      current = { oldStart: Number(m[1]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const tag = line[0];
    if (tag === ' ' || tag === '-' || tag === '+') current.lines.push({ tag, text: line.slice(1) });
    else if (line === '') current.lines.push({ tag: ' ', text: '' }); // 去掉尾随空白后的空上下文行
  }
  if (!hunks.length) throw new Error('补丁里没有 @@ hunk 头');
  return hunks;
}

// 返回 { text, hunks } 或抛出错误；原文件不变。
export function applyUnifiedPatch(original, patchText) {
  const hunks = parseUnifiedPatch(patchText);
  const src = String(original ?? '').replace(/\r\n/g, '\n');
  const eol = String(original ?? '').includes('\r\n') ? '\r\n' : '\n';
  const out = src.split('\n');
  let offset = 0; // 已应用 hunk 带来的行数变化
  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const before = hunk.lines.filter((l) => l.tag !== '+').map((l) => l.text);
    const after = hunk.lines.filter((l) => l.tag !== '-').map((l) => l.text);
    // 从声明的位置开始，向前后各搜索（允许行号漂移），但必须精确匹配
    const expected = Math.max(0, hunk.oldStart - 1 + offset);
    let at = -1;
    for (let d = 0; d <= out.length && at < 0; d++) {
      for (const cand of d === 0 ? [expected] : [expected - d, expected + d]) {
        if (cand < 0 || cand > out.length) continue;
        if (before.every((text, i) => out[cand + i] === text)) { at = cand; break; }
      }
    }
    if (at < 0) throw new Error(`第 ${h + 1} 个 hunk（原始行 ${hunk.oldStart}）的上下文与文件不一致，已拒绝整个补丁`);
    out.splice(at, before.length, ...after);
    offset += after.length - before.length;
  }
  return { text: out.join(eol), hunks: hunks.length };
}

// 静态检查：只报告可以从源码确定的问题，不做渲染与颜色对比计算。
export function inspectHtml(html, { DOMParserImpl = globalThis.DOMParser } = {}) {
  if (!DOMParserImpl) throw new Error('当前环境没有 DOMParser，无法检查 HTML');
  const doc = new DOMParserImpl().parseFromString(String(html ?? ''), 'text/html');
  const issues = [];
  const add = (level, rule, message) => issues.push({ level, rule, message });
  const root = doc.documentElement;
  if (!root.getAttribute('lang')) add('warn', 'html-lang', '<html> 缺少 lang 属性（影响读屏与断行）');
  if (!doc.querySelector('meta[charset]')) add('warn', 'meta-charset', '缺少 <meta charset>');
  if (!doc.querySelector('meta[name="viewport"]')) add('info', 'meta-viewport', '缺少 viewport meta（移动端可能缩放异常）');
  if (!doc.title || !doc.title.trim()) add('warn', 'title', '<title> 为空或缺失');
  const h1s = doc.querySelectorAll('h1');
  if (h1s.length === 0) add('info', 'h1', '页面没有 <h1>');
  if (h1s.length > 1) add('info', 'h1-multiple', `页面有 ${h1s.length} 个 <h1>`);
  let prev = 0;
  for (const h of doc.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) add('info', 'heading-skip', `标题层级跳跃：h${prev} 后直接出现 h${level}`);
    prev = level;
  }
  for (const img of doc.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) add('warn', 'img-alt', `图片缺少 alt：${(img.getAttribute('src') || '').slice(0, 60)}`);
  }
  for (const a of doc.querySelectorAll('a')) {
    const text = (a.textContent || '').trim() || a.getAttribute('aria-label') || '';
    if (!text) add('warn', 'link-text', `链接没有可读文字：${(a.getAttribute('href') || '').slice(0, 60)}`);
    if (/^(点击这里|here|click here|更多|more)$/i.test(text)) add('info', 'link-vague', `链接文字过于笼统：「${text}」`);
  }
  for (const btn of doc.querySelectorAll('button')) {
    const text = (btn.textContent || '').trim() || btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
    if (!text) add('warn', 'button-name', '按钮没有可访问名称');
  }
  for (const input of doc.querySelectorAll('input, textarea, select')) {
    const id = input.getAttribute('id');
    const labelled = input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')
      || (id && doc.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`)) || input.closest('label');
    if (!labelled && input.getAttribute('type') !== 'hidden') add('info', 'form-label', `表单控件缺少标签：${input.tagName.toLowerCase()}${id ? '#' + id : ''}`);
  }
  for (const s of doc.querySelectorAll('script[src]')) {
    if (/^https?:\/\//i.test(s.getAttribute('src') || '')) add('info', 'external-script', `引用了外部脚本：${s.getAttribute('src').slice(0, 80)}`);
  }
  const counts = { error: 0, warn: 0, info: 0 };
  for (const i of issues) counts[i.level === 'warn' ? 'warn' : 'info'] += 1;
  return { issues, counts: { warn: counts.warn, info: counts.info } };
}

// 极简 CSV 解析（支持双引号字段与转义引号）；返回 { header, rows }
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const records = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); records.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const nonEmpty = records.filter((r) => r.some((v) => v !== ''));
  if (!nonEmpty.length) throw new Error('CSV 为空');
  return { header: nonEmpty[0], rows: nonEmpty.slice(1) };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 把一列标签与一列数值渲染为 SVG。数值列必须全部可解析为有限数字；否则报错，不画半张图。
export function chartSvg(csvText, { type = 'bar', label, value, title = '' } = {}) {
  const { header, rows } = parseCsv(csvText);
  const li = header.indexOf(label), vi = header.indexOf(value);
  if (li < 0) throw new Error(`找不到标签列「${label}」`);
  if (vi < 0) throw new Error(`找不到数值列「${value}」`);
  if (type !== 'bar' && type !== 'line') throw new Error('type 只能是 bar 或 line');
  if (rows.length < 1) throw new Error('没有数据行');
  if (rows.length > 200) throw new Error('数据行超过 200，请先用 data_tool 聚合再画图');
  const points = rows.map((r, idx) => {
    const raw = String(r[vi] ?? '').trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) throw new Error(`第 ${idx + 1} 行的「${value}」不是有效数字：${raw.slice(0, 20)}`);
    return { label: String(r[li] ?? ''), value: n };
  });
  const W = 640, H = 360, pad = { l: 56, r: 16, t: 40, b: 72 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(0, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const y = (v) => pad.t + ih - ((v - min) / span) * ih;
  const step = iw / points.length;
  const parts = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  if (title) parts.push(`<text x="${W / 2}" y="24" text-anchor="middle" font-size="16" fill="#222">${esc(title)}</text>`);
  for (let k = 0; k <= 4; k++) {
    const v = min + (span * k) / 4;
    parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e5e5"/>`);
    parts.push(`<text x="${pad.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#666">${esc(Number(v.toFixed(2)))}</text>`);
  }
  if (type === 'bar') {
    points.forEach((p, i) => {
      const x = pad.l + i * step + step * 0.15, w = step * 0.7;
      const top = Math.min(y(p.value), y(0)), h = Math.abs(y(p.value) - y(0));
      parts.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#3b6fd8"/>`);
    });
  } else {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${(pad.l + i * step + step / 2).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="#3b6fd8" stroke-width="2"/>`);
    points.forEach((p, i) => parts.push(`<circle cx="${(pad.l + i * step + step / 2).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="#3b6fd8"/>`));
  }
  points.forEach((p, i) => {
    const cx = pad.l + i * step + step / 2;
    parts.push(`<text x="${cx.toFixed(1)}" y="${H - pad.b + 16}" text-anchor="end" font-size="11" fill="#444" transform="rotate(-35 ${cx.toFixed(1)} ${H - pad.b + 16})">${esc(p.label.slice(0, 24))}</text>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif">${parts.join('')}</svg>\n`;
}
