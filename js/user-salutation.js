import { policyTextHeuristic } from './local-text-policy.js';

export const USER_SALUTATION_KEY = 'dubhe.user-salutation.v1';
export const MAX_USER_SALUTATION_LENGTH = 8;

const SAFE_DEFAULTS_ZH = ['小星', '青禾', '远山', '云舟', '知微', '小满', '星野', '清和', '北辰', '拾光', '阿澈', '听雨', '行舟', '青松', '小岚', '一诺', '沐风', '向晚', '麦芽', '秋白'];
const SAFE_DEFAULTS_EN = ['Nova', 'Sage', 'River', 'Sky', 'Sunny', 'Robin', 'Avery', 'Rowan', 'Riley', 'Quinn', 'Casey', 'Taylor', 'Jamie', 'Morgan', 'Reese', 'Alex'];
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u;
const ALLOWED_CHARS = /^[\p{L}\p{N}\p{M} _.'’·-]+$/u;
let memoryFallback = '';

export function normalizeUserSalutation(raw) {
  let value = String(raw ?? '');
  try { value = value.normalize('NFC'); } catch { /* old browser */ }
  return value.replace(/\s+/gu, ' ').trim();
}

export function countUserSalutationCharacters(value) {
  const text = String(value ?? '');
  try {
    if (typeof Intl?.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  } catch { /* use code points below */ }
  return Array.from(text).length;
}

export function validateUserSalutation(raw) {
  const value = normalizeUserSalutation(raw);
  if (!value) return { ok: false, value, reason: '称谓不能为空。', code: 'empty' };
  if (CONTROL_CHARS.test(value) || /[\r\n\t]/u.test(String(raw ?? ''))) return { ok: false, value, reason: '请使用单行称谓。', code: 'control-character' };
  if (countUserSalutationCharacters(value) > MAX_USER_SALUTATION_LENGTH) return { ok: false, value, reason: '称谓最多 8 个字符。', code: 'too-long' };
  if (!ALLOWED_CHARS.test(value)) return { ok: false, value, reason: '仅支持文字、数字、空格和常用连接符。', code: 'invalid-characters' };

  // Strict, local-only gate: this calls the deterministic policy layer directly. It never
  // calls Jev, a gateway, or a model API, regardless of the app's moderation toggle.
  const policy = policyTextHeuristic(value);
  if (policy.blocked || (policy.categories || []).length) {
    return { ok: false, value, reason: '称谓未通过本地内容审核。', code: 'moderation', policy };
  }
  return { ok: true, value, reason: '', code: 'available', policy };
}

function pickDefault(language, random) {
  const list = language === 'en' ? SAFE_DEFAULTS_EN : SAFE_DEFAULTS_ZH;
  let sample = 0;
  try {
    if (typeof globalThis.crypto?.getRandomValues === 'function' && random === Math.random) {
      const word = new Uint32Array(1);
      globalThis.crypto.getRandomValues(word);
      sample = word[0] / 0x1_0000_0000;
    } else sample = Number(random());
  } catch { sample = Math.random(); }
  const index = Math.min(list.length - 1, Math.max(0, Math.floor((Number.isFinite(sample) ? sample : 0) * list.length)));
  return list[index];
}

function readStored(storage) {
  try { return storage?.getItem?.(USER_SALUTATION_KEY) || ''; } catch { return ''; }
}
function writeStored(value, storage) {
  try { storage?.setItem?.(USER_SALUTATION_KEY, value); } catch { /* privacy mode / quota: keep this page stable in memory */ }
  memoryFallback = value;
}

export function getOrCreateUserSalutation(preferred = '', { storage = globalThis.localStorage, language = 'zh', random = Math.random } = {}) {
  const fromState = validateUserSalutation(preferred);
  if (fromState.ok) {
    if (readStored(storage) !== fromState.value) writeStored(fromState.value, storage);
    return fromState.value;
  }
  const stored = validateUserSalutation(readStored(storage) || memoryFallback);
  if (stored.ok) return stored.value;
  const generated = pickDefault(language, random);
  writeStored(generated, storage);
  return generated;
}

export function saveUserSalutation(raw, { storage = globalThis.localStorage } = {}) {
  const result = validateUserSalutation(raw);
  if (!result.ok) return result;
  writeStored(result.value, storage);
  return result;
}

export function buildWelcomeGreeting(name, language = 'zh', date = new Date(), random = Math.random) {
  const safeName = normalizeUserSalutation(name) || (language === 'en' ? 'friend' : '朋友');
  const hour = Number(date?.getHours?.()) || 0;
  const period = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : hour >= 18 && hour < 23 ? 'evening' : 'late';
  const zh = {
    morning: [['早上好，{name}', '今天想从什么开始？'], ['早安，{name}', '今天有什么想一起完成？'], ['新的一天，{name}', '先来做点什么？']],
    afternoon: [['下午好，{name}', '今天想先处理哪件事？'], ['见到你真好，{name}', '有什么新想法？'], ['午后好，{name}', '接下来想做什么？']],
    evening: [['晚上好，{name}', '今天还想完成什么？'], ['欢迎回来，{name}', '还有什么想一起处理？'], ['晚上好，{name}', '把脑海里的想法说给我听。']],
    late: [['还在忙吗，{name}？', '我可以帮你处理什么？'], ['欢迎回来，{name}', '现在想做点什么？'], ['夜深了，{name}', '还有什么需要我搭把手？']],
  };
  const en = {
    morning: [['Good morning, {name}', 'What would you like to start with?'], ['Morning, {name}', 'What shall we make progress on today?'], ['A fresh start, {name}', 'What is on your mind?']],
    afternoon: [['Good afternoon, {name}', 'What would you like to tackle next?'], ['Nice to see you, {name}', 'What are you thinking about?'], ['Afternoon, {name}', 'Where should we begin?']],
    evening: [['Good evening, {name}', 'What would you like to finish today?'], ['Welcome back, {name}', 'What can I help you work through?'], ['Evening, {name}', 'Tell me what is on your mind.']],
    late: [['Still working, {name}?', 'What can I help you with?'], ['Welcome back, {name}', 'What would you like to do now?'], ['Late night, {name}', 'What should we take care of?']],
  };
  const choices = (language === 'en' ? en : zh)[period];
  let sample = 0;
  try { sample = Number(random()); } catch { sample = 0; }
  const index = Math.min(choices.length - 1, Math.max(0, Math.floor((Number.isFinite(sample) ? sample : 0) * choices.length)));
  const [title, prompt] = choices[index];
  return { title: title.replaceAll('{name}', safeName), prompt };
}
