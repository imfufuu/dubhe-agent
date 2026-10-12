// 输入框彩虹光标（自绘）。
//
// 为什么不用原生光标：原生闪烁相位不可控，CSS 换色只能「撞」在随机的时刻，看起来晚半拍；
// 桌面端原生光标也只有 1–2px。所以这里隐藏原生光标（caret-color: transparent），用一个 span 代替：
//   · 位置：隐藏镜像 div 复刻 textarea 的排版，在光标处放一个零宽标记，量它的 offsetLeft/Top；
//   · 闪烁与换色：同一组关键帧驱动（见 styles.css 的 .rb-caret / rb-blink / rb-color），
//     颜色边界正好落在光标熄灭的 50% 时刻，所以颜色总是在看不见的时候切换。
// 输入法合成期间、选中一段文字时隐藏自绘光标（保留原生选区高亮）。
export const CARET_COLORS = Object.freeze(['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#06b6d4', '#2563eb', '#a855f7']);
export const CARET_HOLD_MS = 1100;
export const CARET_CYCLE_MS = CARET_HOLD_MS * CARET_COLORS.length;
export function caretColorAt(ms) {
  const at = Math.max(0, Number(ms) || 0);
  return CARET_COLORS[Math.floor(at / CARET_HOLD_MS) % CARET_COLORS.length];
}

// 镜像需要与 textarea 的排版完全一致（字体 / 边距 / 换行），否则光标会偏移
const MIRROR_PROPS = ['boxSizing', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'lineHeight',
  'letterSpacing', 'textTransform', 'textIndent', 'textAlign', 'wordSpacing', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];

export function installCaretEffect(input, { doc = document } = {}) {
  const win = doc.defaultView;
  const host = input && input.parentElement;
  if (!input || !host || !win) return { stop() {}, refresh() {} };
  // 触屏（iOS / iPad 无触控板）保留原生光标：自绘光标在这些设备上会消失
  if (win.matchMedia && !win.matchMedia('(pointer: fine)').matches) return { stop() {}, refresh() {} };
  input.dataset.caretEffect = 'custom';
  if (win.getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const mirror = doc.createElement('div');
  mirror.className = 'rb-mirror';
  mirror.setAttribute('aria-hidden', 'true');
  const caret = doc.createElement('span');
  caret.className = 'rb-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.hidden = true;
  host.append(mirror, caret);

  let composing = false;
  const place = () => {
    const cs = win.getComputedStyle(input);
    for (const p of MIRROR_PROPS) mirror.style[p] = cs[p];
    mirror.style.width = `${input.offsetWidth}px`;
    mirror.style.height = `${input.offsetHeight}px`;
    mirror.textContent = input.value.slice(0, input.selectionEnd || 0);
    const marker = doc.createElement('span');
    marker.textContent = '\u200b';
    mirror.appendChild(marker);
    const ir = input.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 20;
    caret.style.height = `${lh}px`;
    const x = ir.left - hr.left + marker.offsetLeft - input.scrollLeft;
    const y = ir.top - hr.top + marker.offsetTop - input.scrollTop;
    caret.style.transform = `translate(${x}px, ${y}px)`;
  };
  const update = () => {
    const show = doc.activeElement === input && !composing && !input.disabled && input.selectionStart === input.selectionEnd;
    caret.hidden = !show;
    if (show) place();
  };

  const events = ['input', 'keyup', 'click', 'focus', 'blur', 'scroll', 'mouseup'];
  for (const e of events) input.addEventListener(e, update);
  const onSel = () => { if (doc.activeElement === input) update(); };
  const onStart = () => { composing = true; update(); };
  const onEnd = () => { composing = false; update(); };
  doc.addEventListener('selectionchange', onSel);
  win.addEventListener('resize', update);
  input.addEventListener('compositionstart', onStart);
  input.addEventListener('compositionend', onEnd);
  update();

  return {
    refresh: update,
    stop() {
      for (const e of events) input.removeEventListener(e, update);
      doc.removeEventListener('selectionchange', onSel);
      win.removeEventListener('resize', update);
      input.removeEventListener('compositionstart', onStart);
      input.removeEventListener('compositionend', onEnd);
      mirror.remove(); caret.remove();
    },
  };
}
