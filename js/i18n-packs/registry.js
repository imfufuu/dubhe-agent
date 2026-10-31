// ─── 语言包登记接口 ─────────────────────────────────────────────────────────
// 每个语言包是「中文源文本 → 译文」的扁平对象，只覆盖界面文案（不含会话、模型输出、文件名）。
// 新增语言：新建 js/i18n-packs/<lang>.js，调用 registerLanguagePack('<lang>', { '源文本': '译文', … })，
// 并在 i18n.js 中 import 该文件。查找顺序：目录 catalog（UI_CATALOG）→ 当前语言包 → 英文包 → 中文原文。
// 键必须与 DOM / 源码里的中文字面量逐字一致（去首尾空白后精确匹配）。
import { SUPPORTED_LANGUAGES } from '../locale.js';

const packs = new Map();

export function registerLanguagePack(lang, entries) {
  const code = String(lang || '').trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.includes(code)) throw new RangeError(`unsupported UI language: ${lang}`);
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new TypeError('language pack must be an object');
  const bucket = packs.get(code) || Object.create(null);
  for (const [source, translation] of Object.entries(entries)) {
    if (typeof translation !== 'string') throw new TypeError(`translation for "${source}" must be a string`);
    bucket[source.trim()] = translation;
  }
  packs.set(code, bucket);
  return bucket;
}

export function languagePackEntry(lang, source) {
  const bucket = packs.get(lang);
  const key = String(source ?? '').trim();
  return bucket && Object.hasOwn(bucket, key) ? bucket[key] : undefined;
}

export function registeredLanguages() {
  return [...packs.keys()];
}
