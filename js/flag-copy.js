// 旗帜文本复制语义（2026-11-09）：
//  · 旗帜有标准 Unicode 表示（RI / tag / ZWJ 序列）→ 复制时还原成对应 emoji；
//  · 只有 PUA 码位的设计（历史旗帜、PUA 专有旗形）→ 复制成占位符 [flag]。
// 显示层为了跨浏览器稳定默认渲染 PUA 单码位，复制层负责把语义还原回去。
import { FLAG_COPY_MAP, FLAG_COPY_PLACEHOLDER } from './flag-directive.js?v=2026.10.25.1';

const PUA_RE = /[\uE000-\uF8FF]/gu;
const puaOf = (ch) => FLAG_COPY_MAP.get(ch) ?? FLAG_COPY_PLACEHOLDER;

/** 纯文本替换：任何包含 PUA 旗帜的文本都能安全处理。 */
export function flagCopyText(text) {
  const raw = String(text ?? '');
  return PUA_RE.test(raw) ? raw.replace(PUA_RE, puaOf) : raw;
}

export function installFlagCopyHandler({ doc = globalThis.document } = {}) {
  if (!doc || typeof doc.addEventListener !== 'function') return null;
  const onCopy = (event) => {
    const selection = doc.getSelection?.();
    const selected = String(selection?.toString?.() || '');
    if (!selected || !PUA_RE.test(selected)) return; // 普通复制完全不干预
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    clipboard.setData('text/plain', flagCopyText(selected));
    // 富文本复制：把选区克隆出的 HTML 里的 PUA 字符也还原，避免粘贴到别处变豆腐块
    if (selection.rangeCount) {
      try {
        const box = doc.createElement('div');
        box.appendChild(selection.getRangeAt(0).cloneContents());
        clipboard.setData('text/html', flagCopyText(box.innerHTML));
      } catch { /* 某些浏览器不允许克隆选区，纯文本已足够 */ }
    }
    event.preventDefault();
  };
  doc.addEventListener('copy', onCopy);
  return { dispose() { doc.removeEventListener('copy', onCopy); } };
}
