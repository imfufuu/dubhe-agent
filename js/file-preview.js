import { fileBytesFromValue, mimeFromPath } from './zip.js';

// Static document preview only. No JS, remote requests, forms or parent access.
// Interactive project execution remains the explicit local Chromium action.
export function staticPreviewDocument(source, path, fs) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(source), 'text/html');
  const resolve = (ref, from) => {
    if (!ref || /^[a-z][\w+.-]*:|^\/\//i.test(ref)) return null;
    try { const u = new URL(ref, 'https://workspace.invalid/' + from); return decodeURIComponent(u.pathname.slice(1)); } catch { return null; }
  };
  let assetBudget = 8 * 1024 * 1024;
  const asset = (ref, from) => {
    if (/^data:(?:image|font)\//i.test(ref)) return ref;
    const p = resolve(ref, from); if (!p) return '';
    try {
      const raw = fs.read(p), { bytes } = fileBytesFromValue(raw);
      if (bytes.length > Math.min(4 * 1024 * 1024, assetBudget)) return '';
      assetBudget -= bytes.length;
      const font = /\.(woff2?|ttf|otf)$/i.exec(p);
      const mime = font ? `font/${font[1].toLowerCase()}` : mimeFromPath(p);
      if (!/^(image|font)\//.test(mime)) return '';
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `data:${mime};base64,${btoa(binary)}`;
    } catch { return ''; }
  };
  const css = (text, from) => String(text).replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;?/gi, '')
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_, q, ref) => ref.startsWith('#') ? `url(${ref})` : `url("${asset(ref, from)}")`);
  doc.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv], animate, animateMotion, animateTransform, set').forEach(n => n.remove());
  for (const style of doc.querySelectorAll('style')) style.textContent = css(style.textContent, path);
  for (const link of doc.querySelectorAll('link')) {
    const p = resolve(link.getAttribute('href'), path);
    if (link.rel === 'stylesheet' && p) {
      try {
        const text = String(fs.read(p));
        if (text.length > 1024 * 1024) throw new Error('Stylesheet too large');
        const style = doc.createElement('style'); style.textContent = css(text, p); link.replaceWith(style); continue;
      } catch { /* missing */ }
    }
    link.remove();
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase(), value = attr.value;
      if (name.startsWith('on') || ['srcdoc', 'srcset', 'action', 'formaction', 'target', 'autofocus', 'ping'].includes(name)) el.removeAttribute(attr.name);
      else if (name === 'style') el.setAttribute('style', css(value, path));
      else if (['src', 'href', 'xlink:href', 'poster'].includes(name)) {
        if (value.startsWith('#')) continue;
        if (['img', 'image'].includes(el.localName)) el.setAttribute(attr.name, asset(value, path));
        else el.removeAttribute(attr.name);
      }
    }
  }
  const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  doc.head.prepend(csp);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
