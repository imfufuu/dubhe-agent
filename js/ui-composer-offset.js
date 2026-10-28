// ─── UI · 输入区高度 → 浮层定位（「最新输出」「撤销回滚」）─────────────────
// 输入框随文字增多而变高（多行）。浮层若用写死的 bottom 值，会被抬高后的输入框压住文字。
// 这里用 ResizeObserver 把 .composer-wrap 的真实高度写入 .main 的 --composer-wrap-h，
// CSS 据此计算浮层 bottom，保证它始终紧贴输入区上沿。
export function installComposerOffset({ main, wrap }) {
  if (!main || !wrap) return () => {};
  const apply = () => {
    const h = Math.ceil(wrap.offsetHeight || 0);
    if (h > 0) main.style.setProperty('--composer-wrap-h', `${h}px`);
  };
  apply();
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(apply);
    observer.observe(wrap);
  }
  window.addEventListener('resize', apply);
  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', apply);
  };
}
