// UI preference is global; session content is never translated or rewritten.
export const LANGUAGE_KEY = 'dubhe-ui-language';
let override = null;
const listeners = new Set();
export function browserLanguage(nav = globalThis.window?.navigator) {
  const first = String(nav?.language || nav?.languages?.[0] || 'zh').toLowerCase();
  return first.startsWith('en') ? 'en' : 'zh';
}
// 界面语言只有中文 / English 两档；没有保存过偏好时跟随浏览器（不再提供「跟随浏览器」选项）
export function languagePreference() {
  if (override) return override;
  try { const p = globalThis.localStorage?.getItem(LANGUAGE_KEY); if (p === 'zh' || p === 'en') return p; } catch { /* private storage */ }
  return browserLanguage();
}
export function getLanguage() { return languagePreference(); }
export function text(zh, en) { return getLanguage() === 'en' ? en : zh; }
// 切换包装器：由界面层注册（如整页渐白）。run 执行所有语言回调，必须且只能调用一次。
let transition = (run) => run();
export function setLanguageTransition(fn) { transition = fn; }
export function setLanguagePreference(value) {
  const p = value === 'en' ? 'en' : 'zh';
  const changed = p !== getLanguage();
  override = p;
  try { localStorage.setItem(LANGUAGE_KEY, p); } catch { /* usable for this page */ }
  transition(() => { for (const fn of listeners) fn(getLanguage(), p); }, changed);
  return getLanguage();
}
export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
