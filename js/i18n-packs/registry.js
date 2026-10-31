// ─── 语言包登记接口 ─────────────────────────────────────────────────────────
// 每个语言包是「中文源文本 → 译文」的扁平对象，只覆盖界面文案（不含会话、模型输出、文件名）。
// 新增语言：新建 js/i18n-packs/<lang>.js，调用 registerLanguagePack('<lang>', { '源文本': '译文', … })，
// 并在 i18n.js 中 import 该文件。键必须与 DOM / 源码里的中文字面量逐字一致（去首尾空白后精确匹配）。
// 界面查找顺序：目录 catalog（UI_CATALOG）→ 当前语言包 → 英文包 → 中文原文（ uiText 不会回退到中文）。
import { SUPPORTED_LANGUAGES } from '../locale.js';
import { putPackEntries, getPackEntry, packLanguages } from './store.js';

export function registerLanguagePack(lang, entries) {
  const code = String(lang || '').trim().toLowerCase();
  if (!SUPPORTED_LANGUAGES.includes(code)) throw new RangeError(`unsupported UI language: ${lang}`);
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new TypeError('language pack must be an object');
  for (const [source, translation] of Object.entries(entries)) {
    if (typeof translation !== 'string') throw new TypeError(`translation for "${source}" must be a string`);
  }
  return putPackEntries(code, entries);
}

export const languagePackEntry = getPackEntry;
export const registeredLanguages = packLanguages;
