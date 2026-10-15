/* V1.8.2 · 页面过渡 + 语言切换遮罩的统一实现层
 *
 * 两条动效，同一块遮罩（配色与定位都在 css/page-fx.css）：
 *  · 语言切换：整页 opacity 渐隐到主题底色（浅色渐白、深色渐黑）→ 全盖住时替换文案 → 渐显。
 *    必须拿到「盖满」那一刻的回调，所以这里用真实节点 + WAAPI。
 *  · 页面切换：点击站内链接 → <html> 加 fx-leaving，CSS 的 ::before 扫场盖满 → 跳转；
 *    新文档首帧由 js/theme-boot.js 读到离开时写下的标记 → fx-entering，扫场反向揭开，
 *    两段拼起来是一次连续的转场。浏览器返回（bfcache 复原）走反方向。
 *
 * 为什么不用 @view-transition{navigation:auto} 自动接管跨页：meta 下发 CSP 的文档会被
 * Chromium 拒绝跨文档 opt-in（过渡直接 abort 并抛控制台错误），详见 css/page-fx.css 头部说明。
 * 浏览器支持「同文档」View Transition 时，文档页的内置 hash 分区切换会调用原生 API。
 */

export const FX = {
  wipe: 300,          // 与 page-fx.css 的 --fx-wipe-out 对齐：扫场盖满用时，JS 只负责在这之后跳转
  enter: 520,         // 与 --fx-wipe-in 对齐：入场扫场退去后清标记
  langIn: 1000,       // 语言切换：慢一点，读起来像翻页而不是闪屏（沿用 V1.8 的手势节奏）
  langOut: 1300,
  ease: 'cubic-bezier(.45,0,.25,1)',
  markKey: 'dubhe-page-fx',
  markTtl: 4000,
};

/** 动效是否允许：应用内「跟随系统 / 开 / 关」三态与系统偏好一起决定（与语言切换、消息动画同一判据） */
export function motionAllowed(doc = globalThis.document) {
  try {
    const flag = doc?.documentElement?.dataset?.motion;
    if (flag === 'off') return false;
    if (flag === 'on') return true;
    const view = doc?.defaultView || globalThis;
    return !view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch { return false; }
}

/** 全站共用的整页遮罩：渐入 → run()（此时完全盖住，用户看不见重排）→ 渐出 */
const activeVeils = new WeakMap();
export function veilFade(doc, run, options = {}) {
  const inMs = options.inMs == null ? FX.langIn : options.inMs;
  const outMs = options.outMs == null ? FX.langOut : options.outMs;
  const root = doc?.documentElement;
  if (!root || !doc.body || !motionAllowed(doc)) {
    try { return Promise.resolve(run()); } catch (err) { return Promise.reject(err); }
  }
  const old = activeVeils.get(doc);
  if (old) old.cancel();                               // 连点：中断旧遮罩，最新选择优先
  const veil = doc.createElement('div');
  veil.className = 'page-veil';                         // 定位与配色只在 CSS（避开首页 style-src CSP）
  veil.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(veil);
  const record = { animation: null, cancelled: false, cancel() {
    this.cancelled = true;
    try { this.animation?.cancel(); } catch { /* 已结束 */ }
    try { veil.remove(); } catch { /* noop */ }
  } };
  activeVeils.set(doc, record);
  const finish = () => {
    if (activeVeils.get(doc) === record) activeVeils.delete(doc);
    try { veil.remove(); } catch { /* 已移除 */ }
  };
  if (typeof veil.animate !== 'function') {
    try { return Promise.resolve(run()).finally(finish); }
    catch (err) { finish(); return Promise.reject(err); }
  }
  const ease = options.ease || FX.ease;
  const animate = (frames, duration) => {
    record.animation = veil.animate(frames, { duration, easing: ease, fill: 'forwards' });
    return record.animation.finished;
  };
  return animate([{ opacity: 0 }, { opacity: 1 }], inMs)
    .then(() => { if (!record.cancelled) return run(); })
    .then((value) => record.cancelled ? value : animate([{ opacity: 1 }, { opacity: 0 }], outMs).then(() => value))
    .catch((err) => {
      if (record.cancelled || err?.name === 'AbortError') return undefined;
      throw err;
    })
    .finally(finish);
}

/* ── 跨页扫场 ─────────────────────────────────────────────────────────────── */

const SKIP_SELECTOR = '[download],[target],[data-no-fx],[rel~="external"]';

function internalPage(anchor, doc) {
  if (!anchor || anchor.matches(SKIP_SELECTOR)) return null;
  const raw = anchor.getAttribute('href');
  if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // mailto:/tel:/https: 一律放行
  let url = null;
  try { url = new URL(raw, doc.baseURI); } catch { return null; }
  if (url.origin !== doc.location.origin) return null;
  if (!/\.html?$/i.test(url.pathname) && !url.pathname.endsWith('/')) return null;
  if (url.pathname === doc.location.pathname && !url.search && !url.hash) return null; // 同页锚点：不打断平滑滚动
  return url;
}

/** 给页面装上跨页扫场；返回是否接管了点击（减弱动效 / 顶层文档判断不满足时返回 false） */
export function installPageFx(doc = globalThis.document, view = doc?.defaultView) {
  if (!doc || !view || view.top !== view.self) return false;   // iframe（首页示例卡）跟着父页一起换，不自己扫场
  const root = doc.documentElement;
  if (root.dataset.fxLinks === '1') return true;
  root.dataset.fxLinks = '1';

  // 入场：首帧由 js/theme-boot.js 打上 fx-entering（可能是反向），动画结束后摘掉，别让伪元素长期参与合成
  const settle = () => {
    root.classList.remove('fx-entering');
    root.classList.remove('fx-back');
    delete root.dataset.fxFrom;
  };
  if (root.classList.contains('fx-entering')) view.setTimeout(settle, FX.enter + 140);
  // 浏览器返回：bfcache 复原时不经过任何 JS 拦截，这里补一次反向扫场
  view.addEventListener('pageshow', (event) => {
    root.classList.remove('fx-leaving');
    leaving = false;
    if (!event.persisted || !motionAllowed(doc)) return;
    root.classList.add('fx-entering', 'fx-back');
    view.setTimeout(settle, FX.enter + 140);
  });

  let leaving = false;
  doc.addEventListener('click', (event) => {
    if (leaving || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // 新标签 / 下载：不劫持
    const url = internalPage(event.target?.closest?.('a[href]'), doc);
    if (!url || !motionAllowed(doc)) return;
    event.preventDefault();
    leaving = true;
    try {
      view.sessionStorage.setItem(FX.markKey, JSON.stringify({ t: Date.now(), from: (doc.location.pathname.split('/').pop() || 'index.html').slice(0, 40) }));
    } catch { /* 隐私模式：下一页不入场扫场，跳转照常 */ }
    root.classList.add('fx-leaving');
    let armed = false, timer = 0;
    const onPageHide = () => depart();
    const onVisibility = () => { if (doc.visibilityState === 'hidden') depart(); };
    const depart = () => {
      if (armed) return;
      armed = true;
      view.clearTimeout(timer);
      view.removeEventListener('pagehide', onPageHide);
      doc.removeEventListener('visibilitychange', onVisibility);
      view.location.href = url.href;
    };
    timer = view.setTimeout(depart, FX.wipe);
    // 页面被切到后台时动画会被冻结：可见性一变差就立刻走，别把用户卡在旧页
    view.addEventListener('pagehide', onPageHide, { once: true });
    doc.addEventListener('visibilitychange', onVisibility);
  });
  return true;
}

if (typeof globalThis.document !== 'undefined' && typeof globalThis.window !== 'undefined') installPageFx(globalThis.document, globalThis.window);
