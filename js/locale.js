// UI preference is global; session content is never translated or rewritten.
export const LANGUAGE_KEY = 'dubhe-ui-language';
export const SUPPORTED_LANGUAGES = Object.freeze(['zh', 'en', 'ja', 'es', 'fr', 'de', 'ko', 'ru', 'ar']);
export const LANGUAGE_LOCALES = Object.freeze({
  zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR',
  de: 'de-DE', ko: 'ko-KR', ru: 'ru-RU', ar: 'ar',
});
let override = null;
const listeners = new Set();

export function normalizeLanguage(value, fallback = 'zh') {
  const key = String(value || '').trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED_LANGUAGES.includes(key) ? key : fallback;
}
export function browserLanguage(nav = globalThis.window?.navigator) {
  const first = String(nav?.language || nav?.languages?.[0] || 'zh');
  return normalizeLanguage(first, 'zh');
}
export function getIntlLocale(language = getLanguage()) {
  const lang = normalizeLanguage(language, 'zh');
  return LANGUAGE_LOCALES[lang] || LANGUAGE_LOCALES.zh;
}
// 未保存偏好时跟随浏览器语言；旧快照中的 zh/en 值仍然兼容。
export function languagePreference() {
  if (override) return override;
  try {
    const stored = globalThis.localStorage?.getItem(LANGUAGE_KEY);
    if (stored) return normalizeLanguage(stored, browserLanguage());
  } catch { /* private storage */ }
  return browserLanguage();
}
export function getLanguage() { return languagePreference(); }
// Keep legacy zh/en call sites unchanged outside explicitly localized UI keys.
// System prompts, tool outputs, and user conversation data do not switch languages implicitly.
export function text(zh, en, translations = {}) {
  const lang = getLanguage();
  return translations?.[lang] ?? (lang === 'en' ? en : zh);
}
// 切换包装器：由界面层注册（如整页渐白）。run 执行所有语言回调，必须且只能调用一次。
let transition = (run) => run();
export function setLanguageTransition(fn) { transition = typeof fn === 'function' ? fn : ((run) => run()); }
export function setLanguagePreference(value) {
  const p = normalizeLanguage(value, browserLanguage());
  const changed = p !== getLanguage();
  override = p;
  try { globalThis.localStorage?.setItem(LANGUAGE_KEY, p); } catch { /* usable for this page */ }
  transition(() => { for (const fn of listeners) fn(getLanguage(), p); }, changed);
  return getLanguage();
}
export function onLanguageChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
