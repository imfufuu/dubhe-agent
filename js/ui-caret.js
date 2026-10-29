// 输入框彩虹光标（自绘）。
//
// 为什么不用原生光标：原生闪烁相位不可控，CSS 换色只能「撞」在随机的时刻，看起来晚半拍；
// 桌面端原生光标也只有 1–2px。所以这里隐藏原生光标（caret-color: transparent），用一个 span 代替：
//   · 位置：隐藏镜像 div 复刻 textarea 的排版，在光标处放一个零宽标记，量它的 offsetLeft/Top；
//   · 闪烁与换色：同一组关键帧驱动（见 styles.css 的 .rb-caret / rb-blink / rb-color），
//     颜色边界正好落在光标熄灭的 50% 时刻，所以颜色总是在看不见的时候切换。
// 输入法合成期间、选中一段文字时隐藏自绘光标（保留原生选区高亮）。
// 2026-10-21：桌面宽度 3px → 2px（见 styles.css .rb-caret，原生光标也只有 1–2px，3px 显得过粗且右偏 1px）；
// 「减少动效」只停彩虹换色、保留闪烁（rb-blink），与原生光标行为一致。
export const CARET_COLORS = Object.freeze(['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#06b6d4', '#2563eb', '#a855f7']);
export const CARET_HOLD_MS = 1100;
export const CARET_EM = 1.2;
export const CARET_NUDGE = Object.freeze({ x: -1, y: 2 });
export const CARET_CYCLE_MS = CARET_HOLD_MS * CARET_COLORS.length;
export function caretColorAt(ms) {
  const at = Math.max(0, Number(ms) || 0);
  return CARET_COLORS[Math.floor(at / CARET_HOLD_MS) % CARET_COLORS.length];
}

// 镜像需要与 textarea 的排版完全一致（字体 / 边距 / 换行），否则光标会偏移
const MIRROR_PROPS = ['boxSizing', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily', 'lineHeight',
  'letterSpacing', 'textTransform', 'textIndent', 'textAlign', 'wordSpacing', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];

// Windows 用户反馈：高 DPI 缩放 + 中文字体回退时，镜像排版与真实 textarea 的像素坐标不一致，
// 自绘光标与输入位置错位，且原生光标已被隐藏，导致「看起来在 A 处、字实际进在 B 处」。
// 因此 Windows 上不做自绘光标，保留原生光标（位置由系统文本引擎决定，必然正确）。
export function isWindowsPlatform(nav = globalThis.navigator) {
  if (!nav) return false;
  const uaPlatform = nav.userAgentData && nav.userAgentData.platform;
  return /windows/i.test(String(uaPlatform || '')) || /windows/i.test(String(nav.userAgent || '')) || /win(32|64)/i.test(String(nav.platform || ''));
}

export function installCaretEffect(input, { doc = document, nav = globalThis.navigator } = {}) {
  const win = doc.defaultView;
  const host = input && input.parentElement;
  if (!input || !host || !win) return { stop() {}, refresh() {} };
  // 触屏（iOS / iPad 无触控板）保留原生光标：自绘光标在这些设备上会消失
  if (win.matchMedia && !win.matchMedia('(pointer: fine)').matches) return { stop() {}, refresh() {} };
  if (isWindowsPlatform(nav)) { input.dataset.caretEffect = 'native'; return { stop() {}, refresh() {} }; }
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
    // 用亚像素的 getBoundingClientRect 代替整数的 offsetLeft/Top，减少高 DPI 下的取整偏差
    const ir = input.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const mr = marker.getBoundingClientRect(), mirrorRect = mirror.getBoundingClientRect();
    const fs = parseFloat(cs.fontSize) || 14;
    const lh = parseFloat(cs.lineHeight) || fs * 1.4 || 20;
    // V1.8.1：旧版高度取整行行高，比文字长出一截（上冒 2px、下拖 6px 多）。
    // 改为约 1.2em（接近原生光标的字面高度），整体下沉 2px 对齐文字主体；
    // 2px 宽的光标经 CARET_NUDGE.x = -1 左移后，正好以插入点为中心（左右各 1px）。
    caret.style.height = `${Math.round(Math.min(lh, fs * CARET_EM))}px`;
    const x = ir.left - hr.left + (mr.left - mirrorRect.left) - input.scrollLeft + CARET_NUDGE.x;
    const y = ir.top - hr.top + (mr.top - mirrorRect.top) - input.scrollTop + CARET_NUDGE.y;
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
