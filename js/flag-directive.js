// 旗帜快捷指令（2026-11-09）：默认渲染 BabelStone Flags PUA 的**单码位**字形。
// 官网明确建议：RI / tag 序列依赖 COLR/CPAL + GSUB ccmp 合成，且属于 Emoji_Presentation，
// 浏览器可能改用系统彩色 emoji 字体或让 default-ignorable tag 字符整段不可见；
// PUA 版「does not use OpenType features to render character sequences as glyphs」。
// 单码位不受 shaping 缓存与 emoji 字体回退影响，切换标签页后不会整批隐身。
// 仍保留 ZWJ / 旧设计 / 少数无 PUA 映射的序列作为兼容回退。
import { regionalFlags, subdivisionFlags, puaFlags } from './flag-registry.js?v=2026.10.25.1';

const zwjFlags = Object.freeze({
  rainbow: '🏳️‍🌈', 'rainbow-flag': '🏳️‍🌈',
  transgender: '🏳️‍⚧️', 'transgender-flag': '🏳️‍⚧️',
  pirate: '🏴‍☠️', 'pirate-flag': '🏴‍☠️',
  'aboriginal': '🏴‍🦘', 'australian-aboriginal': '🏴‍🦘', 'australian-aboriginal-flag': '🏴‍🦘',
  'refugee-nation': '🏳‍🟧‍⬛‍🟧', 'refugee-nation-flag': '🏳‍🟧‍⬛‍🟧',
});
// Private-use characters in the ordinary (non-PUA-variant) face.
const oldFlags = Object.freeze({
  'mr-old': 0xf000, 'mauritania-old': 0xf000,
  'hn-old': 0xf001, 'honduras-old': 0xf001,
  'sy-old': 0xf002, 'syria-old': 0xf002,
  'de-by-alt': 0xf400, 'de-by-alt1': 0xf400, 'bavaria-alt': 0xf400,
});
const puaAlias = Object.freeze({
  rainbow: 'rainbow-flag', transgender: 'transgender-flag', pirate: 'pirate-flag',
  aboriginal: 'australian-aboriginal-flag', 'australian-aboriginal': 'australian-aboriginal-flag',
  'refugee-nation': 'refugee-nation-flag', 'de-by-alt': 'de-by-alt1',
  'mauritania-old': 'mr-old', 'honduras-old': 'hn-old', 'syria-old': 'sy-old', 'bavaria-alt': 'de-by-alt1',
  'cn-hk': 'hk', 'cn-mo': 'mo', 'nl-aw': 'aw', 'nl-cw': 'cw', 'nl-sx': 'sx',
  'nl-bq1': 'bq-bo', 'nl-bq2': 'bq-sa', 'nl-bq3': 'bq-se', 'us-pr': 'pr', 'us-um': 'um',
  'gb-cym': 'gb-wls', 'gb-ynm': 'gb-agy', 'gb-ffl': 'gb-fln', 'gb-fyn': 'gb-mon', 'gb-bnf': 'gb-pem', 'gb-bmg': 'gb-vgl',
});
/** 把旗帜 ID 归一化后查 PUA 码位；无映射返回 null（调用方回退到 Unicode 序列）。 */
export function puaCodeFor(id) {
  const key = String(id || '').toLowerCase();
  const alias = Object.hasOwn(puaAlias, key) ? puaAlias[key] : key;
  const hex = Object.hasOwn(puaFlags, alias) ? puaFlags[alias] : null;
  return hex ? String.fromCodePoint(parseInt(hex, 16)) : null;
}

/** 复制语义：PUA 单码位没有 Unicode 表示时用它占位。 */
export const FLAG_COPY_PLACEHOLDER = '[flag]';

/** 把旗帜 ID 还原成标准 Unicode emoji 序列；PUA 专有设计返回 null。 */
export function unicodeFlagSequence(id) {
  const key = String(id || '').toLowerCase();
  if (Object.hasOwn(zwjFlags, key)) return zwjFlags[key];
  if (regionalFlags.has(key)) return [...key].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 97)).join('');
  if (subdivisionFlags.has(key)) {
    const tags = [...key.replace('-', '')].map(c => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    return `🏴${tags}${String.fromCodePoint(0xe007f)}`;
  }
  return null;
}

/** PUA 码位 → 复制文本：有 Unicode 对应就还原成 emoji，否则给占位符。 */
export const FLAG_COPY_MAP = (() => {
  const map = new Map();
  for (const [id, hex] of Object.entries(puaFlags)) {
    map.set(String.fromCodePoint(parseInt(hex, 16)), unicodeFlagSequence(id) || FLAG_COPY_PLACEHOLDER);
  }
  // 普通字体里的私用区设计（历史旗帜 / 巴伐利亚备选）同样没有 Unicode 表示
  for (const code of [0xf000, 0xf001, 0xf002, 0xf400]) map.set(String.fromCodePoint(code), FLAG_COPY_PLACEHOLDER);
  return map;
})();

const availablePuaCodes = new Set(Object.values(puaFlags));
const normalPuaCodes = new Set([0xf000, 0xf001, 0xf002, 0xf400]);
const escapeAttr = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const directive = /^::flag\[([a-z0-9-]{1,40})(?:\\?\|([^\]\r\n]{1,200}))?\]::/i;

export function flagSequence(id) {
  id = String(id || '').toLowerCase();
  if (id === 'ussr') id = 'su';
  if (Object.hasOwn(zwjFlags, id)) return { value: zwjFlags[id], puaFont: false };
  if (Object.hasOwn(oldFlags, id)) return { value: String.fromCodePoint(oldFlags[id]), puaFont: false };
  if (id.startsWith('pua-')) {
    let key = id.slice(4);
    if (/^f(?:000|001|002|400)$/.test(key)) return { value: String.fromCodePoint(parseInt(key, 16)), puaFont: false };
    key = Object.hasOwn(puaAlias, key) ? puaAlias[key] : key;
    const hex = Object.hasOwn(puaFlags, key) ? puaFlags[key] : key;
    if (availablePuaCodes.has(hex)) return { value: String.fromCodePoint(parseInt(hex, 16)), puaFont: true };
    return null;
  }
  if (/^f(?:000|001|002|400)$/.test(id) && normalPuaCodes.has(parseInt(id, 16))) return { value: String.fromCodePoint(parseInt(id, 16)), puaFont: false };
  if (regionalFlags.has(id) || subdivisionFlags.has(id)) {
    const pua = puaCodeFor(id);
    if (pua) return { value: pua, puaFont: true };
    // 只有 4 个自定义伪代码（xe/xn/xs/xw）没有 PUA 映射，保留 Unicode 序列。
    if (regionalFlags.has(id)) return { value: [...id].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 97)).join(''), puaFont: false };
    const tags = [...id.replace('-', '')].map(c => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('');
    return { value: `🏴${tags}${String.fromCodePoint(0xe007f)}`, puaFont: false };
  }
  return null;
}

export function flagMarkup(input) {
  const match = directive.exec(input);
  if (!match) return null;
  const label = (match[2] || match[1]).trim();
  // Tokens restored by the Markdown extension cannot safely appear in HTML attributes.
  if (!label || /[<>\u0000-\u001f\uE000-\uF8FF]/u.test(label)) return null;
  const flag = flagSequence(match[1]);
  if (!flag) return null;
  const code = escapeAttr(String(match[1] || '').toUpperCase());
  return { length: match[0].length, html: `<span class="md-flag${flag.puaFont ? ' md-flag-pua' : ''}" role="img" aria-label="${escapeAttr(label)}" data-code="${code}">${flag.value}</span>` };
}

// Pipe characters in a directive are not table separators. Protect only on
// candidate table lines; the block parser removes the escape before inline parsing.
export function protectFlagTablePipes(source) {
  return source.replace(/^(?! {4}|\t)[^\n]*\|[^\n]*$/gm, line => line.replace(/(^|[^\\])(::flag\[[a-z0-9-]{1,40})\|([^\]\r\n]{1,200}\]::)/gi, '$1$2\\|$3'));
}

export function installFlagRule(md) {
  md.renderer.rules.dubhe_flag = (tokens, index) => tokens[index].content;
  md.inline.ruler.before('text', 'dubhe_flag', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3a) return false;
    const match = flagMarkup(state.src.slice(state.pos));
    if (!match) return false;
    if (!silent) state.push('dubhe_flag', '', 0).content = match.html;
    state.pos += match.length;
    return true;
  });
}

export function extractFallbackFlags(source, flags) {
  return source.replace(/::flag\[[a-z0-9-]{1,40}(?:\\?\|[^\]\r\n]{1,200})?\]::/gi, (raw, offset, text) => {
    // Do not put HTML placeholders inside an autolink or link destination.
    const prefix = text.slice(0, offset).split('\n').pop();
    if (/^(?: {4}|\t)/.test(prefix) || /(?:https?:\/\/[^\s]*|\]\([^\s)]*)$/i.test(prefix)) return raw;
    const match = flagMarkup(raw);
    if (!match) return raw;
    flags.push(match.html);
    return `\uE000FLAG${flags.length - 1}\uE000`;
  });
}
