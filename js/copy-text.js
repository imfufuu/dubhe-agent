// 统一的复制入口：优先 Clipboard API；在非安全上下文（http + 局域网 IP）或权限被拒时，
// 回退到 textarea + execCommand('copy')。始终返回 Promise<boolean>，调用方据此给出成功 / 失败提示，
// 不再出现「点了没反应」——之前 navigator.clipboard 为 undefined 时会同步抛错且没有任何提示。
export function copyFallback(value) {
  const active = document.activeElement;
  const start = active?.selectionStart, end = active?.selectionEnd, direction = active?.selectionDirection;
  const ta = document.createElement('textarea');
  ta.value = String(value ?? '');
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.append(ta);
  const sel = document.getSelection();
  const saved = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (saved && sel) { sel.removeAllRanges(); sel.addRange(saved); }
  if (active?.isConnected && typeof active.focus === 'function') {
    active.focus({ preventScroll: true });
    if (typeof start === 'number' && typeof end === 'number' && typeof active.setSelectionRange === 'function') {
      try { active.setSelectionRange(start, end, direction || 'none'); } catch { /* non-text input */ }
    }
  }
  return ok;
}

export async function copyText(value) {
  const text = String(value ?? '');
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && (typeof isSecureContext === 'undefined' || isSecureContext)) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 权限被拒：继续走回退 */ }
  return copyFallback(text);
}
