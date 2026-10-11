// 输入框光标彩虹色：红→黄→蓝→绿→青→蓝→紫，一个颜色停 CARET_HOLD_MS。
//
// 关键取舍（2026.10.11.1 重做）：
//   · 颜色切换交给 CSS 关键帧（见 styles.css 的 @keyframes caret-rainbow），JS 不再每隔 120ms 写
//     inline caret-color —— 那样每写一次就可能重置浏览器的光标闪烁计时器，结果是「只有颜色变、光标不闪」，
//     而且 7 色 2.5 秒一轮看着很躁。
//   · 一个颜色停 1.1 秒（略长于原生闪烁周期 ~1s），视觉上就是「闪一下、换个颜色」，不再是连续渐变。
//   · 只动 caret-color 一个属性：不碰 ::selection（选择框颜色）、不碰 -webkit-text-fill-color /
//     text-decoration（输入法合成下划线），因此不会干涉选区与输入法自身的配色。
//   · 中文/日文输入法合成期间暂停动画（合成结束后恢复），避免输入法候选阶段的配色被搅动。
//   · 失焦 / 减少动效 / 显式关动效：停在一个固定颜色，不再轮转。
export const CARET_COLORS = Object.freeze(['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#06b6d4', '#2563eb', '#a855f7']);
export const CARET_HOLD_MS = 1100;
export const CARET_CYCLE_MS = CARET_HOLD_MS * CARET_COLORS.length;
export function caretColorAt(ms) {
  const at = Math.max(0, Number(ms) || 0);
  return CARET_COLORS[Math.floor(at / CARET_HOLD_MS) % CARET_COLORS.length];
}
export function installCaretEffect(input, { doc = document } = {}) {
  if (!input) return { stop() {} };
  input.dataset.caretEffect = 'rainbow';
  const composing = (on) => { input.classList.toggle('caret-rainbow-paused', !!on); };
  const onStart = () => composing(true);
  const onEnd = () => composing(false);
  input.addEventListener('compositionstart', onStart);
  input.addEventListener('compositionend', onEnd);
  // 失焦/切后台由 CSS 的 :not(:focus) 与 data-motion 负责，不需要 JS 计时器。
  return { stop() { input.removeEventListener('compositionstart', onStart); input.removeEventListener('compositionend', onEnd); composing(false); } };
}
