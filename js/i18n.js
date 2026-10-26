import { UI_CATALOG } from './ui-catalog.js?v=2026.10.25.1';
import { UI_STRINGS } from './ui-strings.js?v=2026.10.25.1';
import { getLanguage, getIntlLocale, normalizeLanguage } from './locale.js';

// Missing translations fall back in this order: selected language → English → original Chinese source.
export const UI_TRANSLATION_FALLBACK = Object.freeze(['requested-language', 'English', 'original-source']);
const EN_RULES = [
  [/^(Dubhe Agent) · 构建 (.+)$/, '$1 · Build $2'],
  [/^(Dubhe Agent V1\.\d+) · 构建 (.+) · 独立项目，与 TeamoRouter 互不隶属$/, '$1 · Build $2 · Independent of TeamoRouter'],
  [/^(Dubhe Agent V1\.\d+) · 构建 (.+)$/, '$1 · Build $2'],
  [/^思考 (.+)$/, 'Reasoning $1'], [/^已禁用 (\d+)$/, '$1 disabled'], [/^(\d+) 个会话 · (.+)$/, '$1 conversations · $2'],
  [/^剩余 (.+)$/, 'Remaining $1'], [/^已用 (.+)$/, 'Used $1'],
  [/^(\d+) 个文件$/, '$1 files'], [/^已选 (\d+) 条$/, '$1 selected'],
  [/^思考 ([\d.]+s)$/, 'Thinking $1'], [/^耗时 (.+)$/, 'Duration $1'],
  [/^已复制 (.+)$/, 'Copied $1'], [/^已删除 (\d+) .+$/, 'Deleted $1 items'],
  [/^共 (\d+) .+$/, 'Total: $1'], [/^无匹配模型$/, 'No matching models'],
  [/^未找到 (.+)$/, 'Not found: $1'], [/^加载更早的消息.*$/, 'Load earlier messages'],
  [/^显示最近 (\d+) 条.*$/, 'Showing the latest $1 messages'],
  [/^当前沙箱 (.+)$/, 'Workspace: $1'], [/^已连接：(.+)$/, 'Connected: $1'],
  [/^自定义地址不可用：(.+)$/, 'Custom relay unavailable: $1'],
  [/^已添加模型 ID：(.+)$/, 'Added model ID: $1'], [/^已移除模型 ID：(.+)$/, 'Removed model ID: $1'],
  [/^(.+) 官方文档$/, '$1 official docs'],
];

function interpolate(template, params, language) {
  const locale = getIntlLocale(language);
  return String(template).replace(/\{([\w.-]+)\}/g, (token, name) => {
    const value = params && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : undefined;
    if (value == null) return token;
    return typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat(locale).format(value)
      : String(value);
  });
}

/** Keyed, parameterized UI translation. It never receives or rewrites conversation bodies. */
export function t(key, params = {}, language = getLanguage()) {
  const lang = normalizeLanguage(language, 'zh');
  const source = String(key ?? '');
  const row = UI_CATALOG[source];
  const template = row?.[lang] ?? row?.en ?? (lang === 'zh' ? source : (UI_STRINGS[source] ?? source));
  return interpolate(template, params, lang);
}

/** Translate a single UI string using the bundled catalog and the legacy zh→en dictionary. */
export function translateUI(value, language = getLanguage()) {
  const raw = String(value ?? '');
  const lang = normalizeLanguage(language, 'zh');
  const key = raw.trim();
  if (lang === 'zh') return raw;

  const row = UI_CATALOG[key];
  const localized = row?.[lang] ?? row?.en;
  if (localized != null) return raw.replace(key, localized);

  const exact = Object.hasOwn(UI_STRINGS, key) ? UI_STRINGS[key] : null;
  if (exact) return raw.replace(key, exact);
  for (const [re, replacement] of EN_RULES) {
    if (re.test(key)) return raw.replace(key, key.replace(re, replacement));
  }
  return raw;
}

export function formatNumber(value, options = {}, language = getLanguage()) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return new Intl.NumberFormat(getIntlLocale(language), options).format(n);
}

export function formatTime(value, language = getLanguage()) {
  const date = value instanceof Date ? value : new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(getIntlLocale(language), { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDate(value, language = getLanguage(), options = { month: 'numeric', day: 'numeric' }) {
  const date = value instanceof Date ? value : new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(getIntlLocale(language), { calendar: 'gregory', ...options }).format(date);
}

export function formatDateTime(value, language = getLanguage()) {
  const date = value instanceof Date ? value : new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(getIntlLocale(language), { calendar: 'gregory', dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function formatRelativeTime(value, language = getLanguage(), now = Date.now()) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const seconds = Math.max(0, Math.round((Number(now) - timestamp) / 1000));
  const relative = new Intl.RelativeTimeFormat(getIntlLocale(language), { numeric: 'auto', style: 'long' });
  if (seconds < 45) return relative.format(0, 'second');
  if (seconds < 90) return relative.format(-1, 'minute');
  if (seconds < 3600) return relative.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 5400) return relative.format(-1, 'hour');
  if (seconds < 86400) return relative.format(-Math.round(seconds / 3600), 'hour');
  return relative.format(-Math.round(seconds / 86400), 'day');
}

/** Locale-aware plural selection for parameterized UI labels (uses CLDR categories via Intl). */
export function pluralize(count, formsByLanguage, language = getLanguage()) {
  const lang = normalizeLanguage(language, 'zh');
  const n = Number(count);
  if (!Number.isFinite(n)) return '';
  const locale = getIntlLocale(lang);
  const bundle = formsByLanguage?.[lang] ?? formsByLanguage?.en ?? formsByLanguage?.zh;
  let template = '';
  if (typeof bundle === 'string') template = bundle;
  else if (bundle && typeof bundle === 'object') {
    const category = new Intl.PluralRules(locale).select(n);
    template = bundle[category] ?? bundle.other ?? '';
  }
  return interpolate(template, { count: n }, lang);
}
