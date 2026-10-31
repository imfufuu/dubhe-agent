import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerLanguagePack, languagePackEntry } from '../js/i18n-packs/registry.js';
import { translateUI } from '../js/i18n.js?v=2026.10.25.1';
import { registeredLanguages, languagePackEntry as packEntry } from '../js/i18n-packs/registry.js';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('language pack registry validates language codes, values and merges entries', () => {
  assert.throws(() => registerLanguagePack('xx', { a: 'b' }), RangeError);
  assert.throws(() => registerLanguagePack('ja', null), TypeError);
  assert.throws(() => registerLanguagePack('ja', { '源': 1 }), TypeError);
  registerLanguagePack('ja', { ' 测试源 ': '試験元' });
  assert.equal(languagePackEntry('ja', '测试源'), '試験元', 'keys are trimmed before lookup');
  assert.equal(translateUI('测试源', 'ja'), '試験元');
});

test('UI strings missing a translation fall back to English, then to the Chinese source', () => {
  assert.equal(translateUI('已停止', 'en'), 'Stopped');
  assert.equal(translateUI('已停止', 'ja'), '停止しました', 'catalog rows keep priority over packs');
  const packOnly = '代码沙箱已关闭：不再执行代码，文件读写、生图与子智能体委派仍可用';
  assert.equal(translateUI(packOnly, 'ja'), packEntry('ja', packOnly), 'ja uses its own pack');
  assert.notEqual(translateUI(packOnly, 'ja'), packOnly);
  registerLanguagePack('en', { '仅英文的测试文案': 'English only' });
  assert.equal(translateUI('仅英文的测试文案', 'ja'), 'English only', 'a key with only an English entry falls back to English');
  assert.equal(translateUI('已停止', 'zh'), '已停止');
  assert.equal(translateUI('不存在的界面文案', 'en'), '不存在的界面文案');
});

test('audit: every Chinese UI string in the chat page is registered or uses text()/t()', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/i18n-audit.mjs'), '--json'], { encoding: 'utf8' });
  const findings = JSON.parse(out);
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line || 'H'} ${f.text}`), [],
    '新增中文界面文案请登记到 js/i18n-packs/<lang>.js，或改用 text(zh,en) / t(key)');
});

// 每种语言都必须覆盖英文包的全部键，且不得残留中文（ja / ko 允许使用各自文字中的汉字）。
const enSource = readFileSync(path.join(root, 'js/i18n-packs/en.js'), 'utf8');
const enKeys = [...enSource.matchAll(/^  "((?:[^"\\]|\\.)*)": /gm)].map((m) => JSON.parse(`"${m[1]}"`));
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const HAN_ALLOWED = new Set(['ja', 'ko']);

test('every language pack covers every English UI key without omission', () => {
  for (const lang of ['ja', 'es', 'fr', 'de', 'ko', 'ru', 'ar']) {
    assert.ok(registeredLanguages().includes(lang), `${lang} pack is registered`);
    const missing = enKeys.filter((k) => languagePackEntry(lang, k) == null);
    assert.deepEqual(missing, [], `${lang} pack is missing keys`);
  }
});

test('non-CJK language packs contain no leftover Chinese, and no translation is empty', () => {
  for (const lang of ['ja', 'es', 'fr', 'de', 'ko', 'ru', 'ar']) {
    for (const key of enKeys) {
      const value = languagePackEntry(lang, key);
      assert.ok(value && value.trim(), `${lang} empty translation for "${key}"`);
      if (!HAN_ALLOWED.has(lang)) assert.ok(!CJK.test(value), `${lang} still contains CJK: ${value}`);
    }
  }
});
