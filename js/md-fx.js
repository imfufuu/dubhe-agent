// Dubhe Agent · Markdown 排版扩展的纯函数部分（无 DOM 依赖，便于单测）
// 语法：
//   :::gradient <预设 | #c1 #c2 [#c3 [#c4]]> [角度]      渐变文字
//   :::fx <shimmer|glow|wave|typewriter|neon|rainbow>      动效文字
//   :::fx custom  → 第一段 CSS（白名单净化，仅作用于本块）+ 一行 === + 正文
//   :::card <lift|tilt|ripple|glow>                       悬停 / 点击微交互
//   :::color #rrggbb                                      任意颜色（需通过对比度检查）
// 安全：颜色与角度只接受严格格式；自定义 CSS 经白名单解析，禁止 url()、@import、变量、转义与任何 < > \。

export const GRADIENT_PRESETS = {
  sunset: ['#ff7a18', '#af002d', '#ff3d7f'],
  ocean: ['#2193b0', '#6dd5ed'],
  aurora: ['#00c6ff', '#7b2ff7', '#f107a3'],
  forest: ['#11998e', '#38ef7d'],
  gold: ['#f7971e', '#ffd200', '#f7971e'],
  neon: ['#ff00cc', '#3333ff'],
  candy: ['#ff9a9e', '#fad0c4', '#a18cd1'],
  mono: ['#434343', '#9e9e9e'],
};
const PRESET_ALIAS = { 日落: 'sunset', 海洋: 'ocean', 极光: 'aurora', 森林: 'forest', 金色: 'gold', 霓虹: 'neon', 糖果: 'candy', 墨色: 'mono', 灰度: 'mono' };

export const FX_EFFECTS = ['shimmer', 'glow', 'wave', 'typewriter', 'neon', 'rainbow'];
const FX_ALIAS = { 闪光: 'shimmer', 发光: 'glow', 波浪: 'wave', 打字机: 'typewriter', 霓虹闪烁: 'neon', 彩虹: 'rainbow', 自定义: 'custom' };
export const CARD_KINDS = ['lift', 'tilt', 'ripple', 'glow'];
const CARD_ALIAS = { 上浮: 'lift', 倾斜: 'tilt', 涟漪: 'ripple', 发光卡: 'glow' };

// 与 styles.css 中两套主题的 --bg 一致；新增颜色必须对两者都可读
export const THEME_BACKGROUNDS = ['#f0eee6', '#0b0b0b'];
export const TEXT_CONTRAST_MIN = 4.5;

export function hexColor(v) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v || '').trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

function luminance(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function presetKey(name) {
  const raw = String(name || '');
  return GRADIENT_PRESETS[raw.toLowerCase()] ? raw.toLowerCase() : (PRESET_ALIAS[raw] || null);
}

export function gradientCss(spec) {
  const raw = String(spec || '').trim();
  if (!raw) return null;
  // 预设 [角度]：如 `ocean 120`（角度缺省 90）
  const pm = /^(\S+)(?:[ \t]+(-?\d{1,3})(?:deg)?)?$/i.exec(raw);
  const preset = pm ? presetKey(pm[1]) : null;
  if (preset) {
    const angle = pm[2] !== undefined ? Math.min(360, Math.max(0, parseInt(pm[2], 10))) : 90;
    return `linear-gradient(${angle}deg, ${GRADIENT_PRESETS[preset].join(', ')})`;
  }
  let tokens = raw.split(/[\s,，→]+|->/).filter(Boolean);
  // 预设名后紧跟颜色（如 `forest #1f4037 #99f2c8 90`）：以颜色为准，丢弃预设名
  if (tokens.length > 1 && presetKey(tokens[0]) && hexColor(tokens[1])) tokens = tokens.slice(1);
  let angle = 90;
  const colors = [];
  for (const t of tokens) {
    if (/^-?\d{1,3}(?:deg)?$/i.test(t)) { angle = Math.min(360, Math.max(0, parseInt(t, 10))); continue; }
    const hex = hexColor(t);
    if (!hex) return null;
    colors.push(hex);
  }
  if (colors.length < 2 || colors.length > 4) return null;
  return `linear-gradient(${angle}deg, ${colors.join(', ')})`;
}

// 单行写法：`:::gradient ocean 120 正文 :::`。参数取开头连续的合法记号（取最长合法前缀），其余为正文。
// 返回 { arg, body } 或 null（参数不合法时调用方保留原文）。
export function splitInlineFence(kind, rest) {
  const s = String(rest || '').trim();
  if (!s) return null;
  if (kind === 'gradient') {
    const idx = [];
    for (const m of s.matchAll(/\S+/g)) idx.push([m.index, m.index + m[0].length]);
    let best = null;
    for (let n = 1; n <= Math.min(idx.length, 6); n++) {
      const arg = s.slice(idx[0][0], idx[n - 1][1]);
      if (gradientCss(arg)) best = { arg, body: s.slice(idx[n - 1][1]).trim() };
    }
    return best;
  }
  const m = /^(\S+)(?:[ \t]+([\s\S]*))?$/.exec(s);
  if (!m) return null;
  const arg = m[1];
  if (kind === 'fx' && (!fxKind(arg) || fxKind(arg) === 'custom')) return null;
  if (kind === 'card' && !cardKind(arg)) return null;
  return { arg, body: (m[2] || '').trim() };
}

export function fxKind(name) {
  const raw = String(name || '').trim();
  const key = raw.toLowerCase();
  if (key === 'custom' || FX_ALIAS[raw] === 'custom') return 'custom';
  if (FX_EFFECTS.includes(key)) return key;
  return FX_ALIAS[raw] || null;
}

export function cardKind(name) {
  const key = String(name || '').trim().toLowerCase();
  if (CARD_KINDS.includes(key)) return key;
  return CARD_ALIAS[String(name || '').trim()] || null;
}

// ── 自定义 CSS 净化 ───────────────────────────────────────────────
const ALLOWED_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image', 'background-size', 'background-position', 'background-clip', '-webkit-background-clip',
  '-webkit-text-fill-color', 'text-shadow', 'box-shadow', 'border-radius', 'border-color', 'outline-color', 'text-decoration-color',
  'transform', 'transform-origin', 'opacity', 'filter', 'letter-spacing', 'font-weight', 'font-style', 'padding',
  'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-iteration-count', 'animation-timing-function',
  'animation-direction', 'animation-fill-mode', 'transition', 'transition-property', 'transition-duration', 'transition-timing-function',
  'clip-path', 'mix-blend-mode',
]);
const ALLOWED_SELECTORS = new Set(['&', '&::before', '&::after', '&:hover', '&:active', '&:focus-visible']);
const FORBIDDEN_VALUE = /url\s*\(|expression|image-set|@|javascript|behavior|binding|\bimport\b|var\s*\(|env\s*\(|attr\s*\(|[;{}<>\\]/i;
const MAX_SOURCE = 3000;
const MAX_RULES = 24;
const MAX_DECLS = 16;

export function hashId(str) {
  let h = 5381;
  for (const ch of String(str)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

// 顶层块切分：返回 { prelude, body }；括号不平衡返回 null
function splitBlocks(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break; // 结尾的游离文本（如被剔除的 </style> 残片）直接忽略
    const prelude = s.slice(i, open).trim();
    let depth = 1, j = open + 1;
    for (; j < s.length && depth; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; }
    if (depth) return null;
    out.push({ prelude, body: s.slice(open + 1, j - 1) });
    i = j;
  }
  return out;
}

function splitDecls(body) {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseDecls(body, renames) {
  const decls = [];
  for (const raw of splitDecls(body)) {
    const idx = raw.indexOf(':');
    if (idx < 0) continue;
    const prop = raw.slice(0, idx).trim().toLowerCase();
    let val = raw.slice(idx + 1).trim();
    if (!ALLOWED_PROPS.has(prop) || !val || val.length > 240 || FORBIDDEN_VALUE.test(val)) continue;
    if (prop === 'animation' || prop === 'animation-name') {
      val = val.replace(/[A-Za-z_][\w-]*/g, (tok) => renames.get(tok) || tok);
    }
    decls.push(`${prop}: ${val}`);
    if (decls.length >= MAX_DECLS) break;
  }
  return decls;
}

/**
 * 净化 :::fx custom 的 CSS。返回 { css, scope } 或 null（无可用规则）。
 * scope 为块级唯一类名，所有规则都限定在 .scope 下；@keyframes 名加 scope 前缀，避免与页面其它动画冲突。
 */
export function sanitizeCustomCss(src) {
  const raw = String(src || '').slice(0, MAX_SOURCE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/[<>\\]/g, '');
  const scope = `md-fx-c${hashId(raw)}`;
  const blocks = splitBlocks(raw);
  if (!blocks) return null;
  // 先收集 keyframes 名，供 animation 引用改名
  const renames = new Map();
  for (const b of blocks) {
    const m = /^@keyframes\s+([A-Za-z][\w-]{0,40})$/.exec(b.prelude);
    if (m) renames.set(m[1], `${scope}-${m[1]}`);
  }
  const out = [];
  let rules = 0;
  for (const b of blocks) {
    if (++rules > MAX_RULES) break;
    const kf = /^@keyframes\s+([A-Za-z][\w-]{0,40})$/.exec(b.prelude);
    if (kf) {
      const frames = [];
      for (const f of splitBlocks(b.body) || []) {
        const sel = f.prelude.split(',').map((x) => x.trim().toLowerCase());
        if (!sel.every((x) => x === 'from' || x === 'to' || /^\d{1,3}(\.\d+)?%$/.test(x))) continue;
        const decls = parseDecls(f.body, renames);
        if (decls.length) frames.push(`${sel.join(', ')} { ${decls.join('; ')} }`);
      }
      if (frames.length) out.push(`@keyframes ${renames.get(kf[1])} { ${frames.join(' ')} }`);
      continue;
    }
    if (b.prelude.startsWith('@')) continue; // 其它 at-rule 一律丢弃
    const selectors = b.prelude.split(',').map((x) => x.trim()).filter((x) => ALLOWED_SELECTORS.has(x));
    if (!selectors.length) continue;
    const decls = parseDecls(b.body, renames);
    if (!decls.length) continue;
    for (const s of selectors) out.push(`.${scope}${s.slice(1)} { ${decls.join('; ')} }`);
  }
  return out.length ? { css: out.join('\n'), scope } : null;
}

/**
 * 生成块的开标签与闭标签（无效参数返回 null，调用方保留原文）。
 * 返回 { open, close } 字符串；open 中的 style 只包含已校验的值。
 */
export function blockWrapper(kind, arg, { css = '', scope = '' } = {}) {
  if (kind === 'gradient') {
    const g = gradientCss(arg);
    return g ? { open: `<div class="md-gradient" style="--md-grad:${g}">`, close: '</div>' } : null;
  }
  if (kind === 'fx') {
    const k = fxKind(arg);
    if (!k) return null;
    if (k === 'custom') {
      // 没有可用 CSS 时降级为普通容器（正文照常显示）
      if (!css || !scope) return { open: '<div class="md-fx">', close: '</div>' };
      return { open: `<div class="md-fx md-fx-custom ${scope}"><style>${css}</style>`, close: '</div>' };
    }
    return { open: `<div class="md-fx md-fx-${k}">`, close: '</div>' };
  }
  if (kind === 'card') {
    const k = cardKind(arg);
    return k ? { open: `<div class="md-card md-card-${k}">`, close: '</div>' } : null;
  }
  return null;
}

// 把颜色朝中性灰逐步混合，直到对指定背景达到对比度下限；保留尽可能多的色相。
// 注意：两种主题背景之间不存在同时满足 4.5:1 的中间色，因此按主题分别求值。
export function fitReadableOn(hex, bg) {
  const h = hexColor(hex);
  if (!h) return null;
  if (contrastRatio(h, bg) >= TEXT_CONTRAST_MIN) return h;
  // 浅底朝黑色加深，深底朝白色提亮：只向对比度增加的方向移动
  const neutral = luminance(bg) > 0.2 ? '#000000' : '#ffffff';
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = mixHex(h, neutral, t);
    if (contrastRatio(mixed, bg) >= TEXT_CONTRAST_MIN) return mixed;
  }
  return null;
}

function mixHex(a, b, t) {
  const ch = (hex, i) => parseInt(hex.slice(i, i + 2), 16);
  const out = [1, 3, 5].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// 返回 { light, dark }（各自对应主题背景可读），或 null（无法修正）
export function colorPairFor(hex) {
  const [lightBg, darkBg] = THEME_BACKGROUNDS;
  const light = fitReadableOn(hex, lightBg);
  const dark = fitReadableOn(hex, darkBg);
  return light && dark ? { light, dark } : null;
}

// 行内样式：只含两个校验过的颜色变量
export function colorStyleFor(hex) {
  const pair = colorPairFor(hex);
  return pair ? `--md-c-light:${pair.light};--md-c-dark:${pair.dark}` : null;
}
