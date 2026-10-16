const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_SVG_CHARS = 2_000_000;
const BLOCKED_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video',
  'animate', 'animatemotion', 'animatetransform', 'set', 'discard',
]);

function decodeEntities(s) {
  return String(s || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
    const e = entity.toLowerCase();
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    try { return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole; }
    catch { return whole; }
  });
}

/** Read an SVG string stored as source or as an image/svg+xml data URL. */
export function svgSourceFromValue(value) {
  const s = String(value || '').trim();
  const m = /^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/i.exec(s);
  if (!m) return s;
  if (m[1]) {
    const bin = atob(m[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(m[2]);
}

function safeCss(css) {
  return String(css || '')
    .replace(/@import\b[^;]*(?:;|$)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, '')
    .replace(/-moz-binding\s*:[^;}]+/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (all, _quote, target) => {
      const ref = String(target || '').trim();
      return /^#[^\s"'<>]+$/.test(ref) ? `url(${ref})` : 'none';
    })
    .replace(/(?:javascript|vbscript)\s*:/gi, '');
}

function safeReference(value) {
  return /^#[^\s"'<>\u0000-\u001f]+$/.test(String(value || '').trim());
}

function sanitizeWithDom(raw, Parser, Serializer) {
  const doc = new Parser().parseFromString(raw, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('SVG XML 解析失败');
  const root = doc.documentElement;
  if (!root || String(root.localName || root.nodeName).toLowerCase() !== 'svg') throw new Error('根元素不是 <svg>');

  for (const node of [root, ...root.querySelectorAll('*')]) {
    const local = String(node.localName || node.nodeName).toLowerCase();
    if (BLOCKED_ELEMENTS.has(local)) { node.remove(); continue; }
    for (const attr of [...node.attributes]) {
      const name = String(attr.name || '').toLowerCase();
      const localName = String(attr.localName || name.split(':').pop()).toLowerCase();
      const value = String(attr.value || '').trim();
      if (name.startsWith('on') || localName === 'src' || localName === 'base') {
        node.removeAttribute(attr.name);
        continue;
      }
      if (localName === 'href' && !safeReference(value)) {
        node.removeAttribute(attr.name);
        continue;
      }
      if (localName === 'style') {
        const cleaned = safeCss(value);
        if (cleaned) node.setAttribute(attr.name, cleaned);
        else node.removeAttribute(attr.name);
        continue;
      }
      if (/url\s*\(/i.test(value)) node.setAttribute(attr.name, safeCss(value));
      if (/(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i.test(value)) node.removeAttribute(attr.name);
    }
  }
  for (const style of [...root.querySelectorAll('style')]) style.textContent = safeCss(style.textContent || '');
  root.setAttribute('xmlns', SVG_NS);
  return new Serializer().serializeToString(root);
}

function assertBalancedXmlTags(markup) {
  const source = String(markup || '').replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, '');
  const stack = [];
  for (let i = 0; i < source.length;) {
    if (source[i] !== '<') { i++; continue; }
    let end = i + 1;
    let quote = '';
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (end >= source.length || quote) throw new Error('SVG XML 解析失败');
    const body = source.slice(i + 1, end).trim();
    if (!body || body[0] === '!') throw new Error('SVG XML 含有不支持的声明');
    const closing = body[0] === '/';
    const nameMatch = /^\/?\s*([A-Za-z_][\w:.-]*)\b/.exec(body);
    if (!nameMatch) throw new Error('SVG XML 标签格式无效');
    const tagName = nameMatch[1];
    if (closing) {
      if (body.slice(1).trim() !== tagName || stack.pop() !== tagName) throw new Error(`SVG XML 标签未配对：${tagName}`);
    } else if (!/\/\s*$/.test(body)) stack.push(tagName);
    i = end + 1;
  }
  if (stack.length) throw new Error(`SVG XML 标签未闭合：${stack[stack.length - 1]}`);
}

function sanitizeWithoutDom(raw) {
  let s = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed|audio|video|animate|animateMotion|animateTransform|set|discard)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|foreignObject|iframe|object|embed|audio|video|animate|animateMotion|animateTransform|set|discard)\b[^>]*\/\s*>/gi, '')
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_all, attrs, css) => `<style${attrs}>${safeCss(css)}</style>`);

  const cleanAttr = (name, value) => {
    const n = String(name || '').toLowerCase();
    const local = n.split(':').pop();
    const v = String(value || '').trim();
    if (n.startsWith('on') || local === 'src' || local === 'base') return '';
    if (local === 'href' && !safeReference(v)) return '';
    if (local === 'style') return safeCss(v) ? ` ${name}="${safeCss(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"` : '';
    if (/(?:javascript|vbscript)\s*:|data\s*:\s*text\/html/i.test(v)) return '';
    const cleaned = /url\s*\(/i.test(v) ? safeCss(v) : v;
    return ` ${name}="${cleaned.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`;
  };
  const attrRe = /\s+([^\s=/>]+)\s*=\s*("([\s\S]*?)"|'([\s\S]*?)'|([^\s>]+))/g;
  s = s.replace(/<[^>]*>/g, (tag) => {
    if (/^<(?:\?|!)/.test(tag)) return tag;
    return tag.replace(attrRe, (_all, name, _quoted, doubleValue, singleValue, bareValue) =>
      cleanAttr(name, doubleValue ?? singleValue ?? bareValue));
  });
  const rootNs = /(<svg\b[^>]*?)\s+xmlns\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
  if (rootNs.test(s)) s = s.replace(rootNs, `$1 xmlns="${SVG_NS}"`);
  else s = s.replace(/<svg\b/i, `<svg xmlns="${SVG_NS}"`);
  assertBalancedXmlTags(s);
  return s;
}

/**
 * Remove active content and every non-fragment resource reference from SVG markup.
 * The returned string is suitable for preview/rasterization; malformed or oversized input is rejected.
 */
export function sanitizeSvgMarkup(value, { maxChars = MAX_SVG_CHARS } = {}) {
  let raw = svgSourceFromValue(value).replace(/^\uFEFF/, '').trim();
  if (!raw || raw.length > maxChars) throw new Error(`SVG 为空或超过安全限制（${maxChars} 字符）`);
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('SVG 不允许 DOCTYPE 或自定义实体');
  const rootCandidate = raw
    .replace(/^\s*<\?xml[\s\S]*?\?>/i, '')
    .replace(/^(?:\s|<!--[\s\S]*?-->)+/, '')
    .replace(/(?:\s|<!--[\s\S]*?-->)+$/, '')
    .trim();
  if (!/^<svg(?:\s|>)/i.test(rootCandidate)) throw new Error('根元素不是 <svg>');
  if (!/<\/svg\s*>$/i.test(rootCandidate) && !/^<svg\b[^>]*\/\s*>$/i.test(rootCandidate)) throw new Error('SVG 根元素未闭合');

  const Parser = globalThis.DOMParser;
  const Serializer = globalThis.XMLSerializer;
  const safe = typeof Parser === 'function' && typeof Serializer === 'function'
    ? sanitizeWithDom(raw, Parser, Serializer)
    : sanitizeWithoutDom(raw);
  if (!/<svg\b/i.test(safe)) throw new Error('SVG 清理后无有效根元素');
  return safe;
}

export function svgDataUrl(value) {
  const safe = sanitizeSvgMarkup(value);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safe)}`;
}

/** Return the SVG's native text labels, not OCR from text converted to paths or raster images. */
export function extractSvgText(value) {
  const safe = sanitizeSvgMarkup(value);
  const Parser = globalThis.DOMParser;
  if (typeof Parser === 'function') {
    const doc = new Parser().parseFromString(safe, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG XML 解析失败');
    return [...doc.querySelectorAll('text, title, desc')]
      .map((node) => String(node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }
  const out = [];
  for (const match of safe.matchAll(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const text = decodeEntities(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out.join('\n');
}
