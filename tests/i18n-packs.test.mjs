import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { registerLanguagePack, languagePackEntry } from '../js/i18n-packs/registry.js';
import { translateUI } from '../js/i18n.js?v=2026.10.25.1';

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
  assert.equal(translateUI(packOnly, 'ja'), translateUI(packOnly, 'en'), 'ja without its own pack entry falls back to English');
  assert.equal(translateUI('已停止', 'zh'), '已停止');
  assert.equal(translateUI('不存在的界面文案', 'en'), '不存在的界面文案');
});

test('audit: every Chinese UI string in the chat page is registered or uses text()/t()', () => {
  const out = execFileSync(process.execPath, [path.join(root, 'scripts/i18n-audit.mjs'), '--json'], { encoding: 'utf8' });
  const findings = JSON.parse(out);
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line || 'H'} ${f.text}`), [],
    '新增中文界面文案请登记到 js/i18n-packs/<lang>.js，或改用 text(zh,en) / t(key)');
});
