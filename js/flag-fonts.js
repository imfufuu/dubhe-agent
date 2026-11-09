// ─── 旗帜字体稳定性（2026-11-09）─────────────────────────────────────────────
// 症状：切换浏览器标签页回来后，彩色旗帜先短暂显现，随即整批「隐身」。
// 根因（见 FLAG_RENDERING_REPORT.md）：
//  1. BabelStone Flags 是 COLR/CPAL 彩色字体，靠 GSUB `ccmp` 把 RI / tag 序列
//     合成旗形；BabelStone 官网本身只靠 CSS @font-face 按需下载，没有预加载。
//  2. 浏览器对 Emoji_Presentation 字符（RI、ZWJ、tag 序列）会优先去找系统彩色
//     emoji 字体，CSS 指定的字体可能被跳过；tag 字符又是 default-ignorable，
//     shaping 失败时整段直接不可见。
//  3. 后台标签页会暂停/取消字体下载，切回时重新光栅化：旧的彩色图层闪一下，
//     字体却还不可用，于是全部落到不可见回退。font-display: optional/fallback
//     的 swap period 更会让字体「永久不再交换」，所以这里刻意保留 swap。
//
// 对策：启动即显式 document.fonts.load()（不依赖「渲染到该字符才下载」），
// 每次从后台恢复时复查并重载，再用一次强制 reflow 让彩色字形重新光栅化；
// 字体确实不可用时由 CSS 显示可辨识的代码占位，绝不整批消失。

export const FLAG_READY_ATTR = 'data-flags-ready';

/** 两个旗帜面的代表性字符：必须是各自 unicode-range 内真实存在的字形。 */
export const FLAG_FACES = Object.freeze([
  { family: 'BabelStone Flags', sample: '\u{1F1FA}\u{1F1F8}', file: 'babelstone/flags.woff2' },
  { family: 'BabelStone Flags PUA', sample: '\uE21A', file: 'babelstone/flags-pua.ttf' },
]);

export const fontSpec = (face) => `16px "${face.family}"`;

/**
 * 确保所有旗帜字体可用。fonts 可注入以便单测；无 FontFaceSet 时直接标记 ready，
 * 让 CSS @font-face 自行工作（不显示占位）。
 */
export async function ensureFlagFonts({ fonts, doc = globalThis.document, faces = FLAG_FACES } = {}) {
  const root = doc?.documentElement;
  if (!root) return { ok: false, loaded: 0, missing: faces.length, reason: 'no-document' };
  const set = fonts || doc?.fonts;
  if (!set || typeof set.check !== 'function' || typeof set.load !== 'function') {
    root.setAttribute(FLAG_READY_ATTR, 'ready');
    return { ok: true, loaded: 0, missing: 0, reason: 'no-fontfaceset' };
  }
  const missing = faces.filter((face) => {
    try { return !set.check(fontSpec(face), face.sample); } catch { return true; }
  });
  const results = await Promise.allSettled(missing.map((face) => set.load(fontSpec(face), face.sample)));
  const loaded = results.filter((r) => r.status === 'fulfilled').length;
  const ok = loaded === missing.length;
  // 在 pending / ready 之间强制一次 reflow：浏览器不会把同一任务里的两次属性写入
  // 合并成「什么都没发生」，彩色字形图层会真正重新光栅化。
  root.setAttribute(FLAG_READY_ATTR, 'pending');
  try { void root.offsetHeight; } catch { /* jsdom */ }
  root.setAttribute(FLAG_READY_ATTR, ok ? 'ready' : 'pending');
  return { ok, loaded, missing: missing.length };
}

/** 启动时安装：立即加载一次；每次标签页重新可见时复查并重载。 */
export function installFlagFontRecovery({ doc = globalThis.document, fonts } = {}) {
  if (!doc?.documentElement) return null;
  const root = doc.documentElement;
  root.setAttribute(FLAG_READY_ATTR, 'pending');
  let busy = false, queued = false;
  const refresh = async () => {
    // 加载期间又切了一次标签页：排队补一次，绝不丢掉恢复请求。
    if (busy) { queued = true; return null; }
    busy = true;
    try { return await ensureFlagFonts({ fonts, doc }); }
    finally {
      busy = false;
      if (queued) { queued = false; refresh(); }
    }
  };
  const onVisibility = () => {
    // hidden 是浏览器标签页状态的可靠信号；visibilityState 在部分环境（jsdom / 预渲染）
    // 可能是 'prerender'，用它判断会误跳过恢复。
    if (doc.hidden === true) return;
    refresh();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  const ready = refresh();
  return {
    refresh, ready,
    dispose() { doc.removeEventListener('visibilitychange', onVisibility); },
  };
}
