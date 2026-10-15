/* V1.8.2 · 首帧前置脚本（classic script，放在 <head> 最前面，早于任何样式生效）
 *
 * 为什么单独一个文件：js/theme.js 是 ES module，浏览器会推迟到文档解析完才执行，
 * 于是深色偏好「传递」到另一页时会先画一帧浅色底、再被 0.7s 颜色过渡拖成一次缓慢渐变。
 * 这里在首次绘制前就把偏好写进 <html>，并临时锁掉颜色插值（theme-boot），页面从第一帧就是最终配色。
 *
 * 职责（全部是「不执行也不能出错」的幂等小动作）：
 *   ① 主题：读取顺序与 js/theme.js 完全一致（共享 key → 旧首页 key → 已保存的应用设置 → 回退值）
 *   ② 动效偏好 data-motion：加载屏 / 过渡动画同样要受它控制
 *   ③ 界面语言：lang 与 data-ui-language 提前落好，避免英文偏好下先闪一屏中文
 *   ④ theme-color：移动浏览器状态栏取色不必等 ui.js 挂载
 *   ⑤ 页面入场遮罩标记（fx-entering）：老浏览器没有跨文档 View Transition，
 *      由 js/page-fx.js 在离开上一页时写入 sessionStorage，本页首帧据此反向渐显
 *
 * data-theme-fallback="system" 时（落地页 / 文档页）没有保存过偏好就跟随系统；
 * 应用页不写该属性 → 沿用 js/theme.js 的默认浅色，行为与改造前一致。
 */
(function () {
  var doc = document, root = doc.documentElement, view = doc.defaultView;
  if (!root || !view) return;

  var store = null;
  try { store = view.localStorage || null; } catch (_) { store = null; } // 隐私模式 / 跨源 iframe
  function read(key) { try { return store ? store.getItem(key) : null; } catch (_) { return null; } }
  var VALID = { light: 1, dark: 1 };

  var script = doc.currentScript || (function () {
    var all = doc.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) if (/theme-boot\.js/.test(all[i].getAttribute('src') || '')) return all[i];
    return null;
  }());

  /* ① 主题 —— 与 js/theme.js readThemePreference() 同一套优先级 */
  var theme = read('dubhe-theme') || '';
  if (!VALID[theme]) theme = read('dubhe-home-theme') || '';
  if (!VALID[theme]) {
    var raw = read('dubhe-agent-state-v1-v2') || read('dubhe-agent-state-v1') || '';
    if (raw) { try { var st = JSON.parse(raw); theme = st && st.settings && st.settings.theme; } catch (_) { theme = ''; } }
  }
  var usedSystemFallback = false;
  if (!VALID[theme] && script && script.getAttribute('data-theme-fallback') === 'system') {
    try { theme = view.matchMedia && view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; usedSystemFallback = true; } catch (_) { theme = ''; }
  }
  theme = VALID[theme] ? theme : 'light';
  // 首页原本会在 home.js 启动时保存系统默认值；在更早的首帧就持久化，让从文档页直达应用页也用同一主题。
  if (usedSystemFallback) { try { if (store) store.setItem('dubhe-theme', theme); } catch (_) { /* 隐私模式：只作用于本页 */ } }
  root.setAttribute('data-theme', theme);
  /* ② theme-boot：首帧禁止颜色过渡（两帧后解除，之后的手动切换依旧平滑插值） */
  root.classList.add('theme-boot');
  var unlock = function () { root.classList.remove('theme-boot'); };
  var arm = function () { view.requestAnimationFrame ? view.requestAnimationFrame(function () { view.requestAnimationFrame(unlock); }) : setTimeout(unlock, 80); };
  if (doc.readyState === 'complete' || doc.readyState === 'interactive') { try { arm(); } catch (_) { unlock(); } }
  else doc.addEventListener('DOMContentLoaded', function () { try { arm(); } catch (_) { unlock(); } }, { once: true });

  /* ③ 动效偏好 + 界面语言 */
  var motion = read('dubhe-motion');
  if (motion === 'on' || motion === 'off') root.setAttribute('data-motion', motion);
  var lang = read('dubhe-ui-language');
  if (lang !== 'en' && lang !== 'zh') {
    var browserLang = String(view.navigator && (view.navigator.language || (view.navigator.languages && view.navigator.languages[0])) || '').toLowerCase();
    lang = browserLang.indexOf('en') === 0 ? 'en' : 'zh'; // 与 locale.browserLanguage() 同一默认规则
  }
  root.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
  root.setAttribute('data-ui-language', lang);

  /* ④ 移动端系统栏取色：ui.js 挂载后接管（还要叠加面板遮罩色），这里只负责首帧不露白 */
  try {
    var meta = doc.querySelector('meta[name="theme-color"]:not([media])');
    if (meta && !meta.hasAttribute('media')) {
      var darkColor = (script && script.getAttribute('data-theme-color-dark')) || '#0c0c0b';
      var lightColor = (script && script.getAttribute('data-theme-color-light')) || '#f6f4ef';
      meta.setAttribute('content', theme === 'dark' ? darkColor : lightColor);
    }
  } catch (_) { /* noop */ }

  /* ⑤ 入场遮罩：只在顶层文档播放（iframe 示例卡与父页共用同一次导航，不该各自盖一层） */
  try {
    if (view.top !== view.self) return;
    var ss = view.sessionStorage;
    if (!ss) return;
    var mark = JSON.parse(ss.getItem('dubhe-page-fx') || '0');
    ss.removeItem('dubhe-page-fx');
    if (mark && mark.t && Date.now() - mark.t < 4000) {
      root.classList.add('fx-entering');
      if (mark.from) root.setAttribute('data-fx-from', String(mark.from).slice(0, 40));
    }
  } catch (_) { /* 隐私模式 / 跨源：不做入场动画，内容照常显示 */ }
}());
