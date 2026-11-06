// The shortcuts below emit BabelStone's Unicode sequences, never image URLs.
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
  if (regionalFlags.has(id)) return { value: [...id].map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 97)).join(''), puaFont: false };
  if (subdivisionFlags.has(id)) {
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
  return { length: match[0].length, html: `<span class="md-flag${flag.puaFont ? ' md-flag-pua' : ''}" role="img" aria-label="${escapeAttr(label)}">${flag.value}</span>` };
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
