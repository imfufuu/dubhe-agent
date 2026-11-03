// 中文字体回归测试：宋体风格（Noto Serif SC）与扩展 B 区（BabelStone Han Extra）的字体注册与引用完整性。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(resolve(root, 'assets/fonts-lazy/index.css'), 'utf8');
const styles = readFileSync(resolve(root, 'css/styles.css'), 'utf8');

test('Noto Serif SC 已打包为懒加载字体族，共 98 个分片', () => {
  const rules = index.split('@font-face').length - 1;
  assert.ok(rules >= 752, `@font-face 规则应至少 752 条，实际 ${rules}`);
  assert.equal(index.split('font-family: "Noto Serif SC";').length - 1, 98);
  assert.ok(existsSync(resolve(root, 'assets/fonts-lazy/licenses/serif-sc-LICENSE.txt')), '缺少 Noto Serif SC 许可证');
});

test('index.css 引用的字体文件全部存在（无断链）', () => {
  const urls = [...index.matchAll(/url\("\.\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 700);
  const missing = urls.filter((u) => !existsSync(resolve(root, 'assets/fonts-lazy', u)));
  assert.deepEqual(missing.slice(0, 5), []);
});

test('--chat-font：宋体风格优先，并包含 BabelStone Han Extra（扩展 B 区）', () => {
  const m = styles.match(/--chat-font:\s*([^;]+);/);
  assert.ok(m, '缺少 --chat-font');
  const stack = m[1].split(',').map((s) => s.trim().replace(/"/g, ''));
  assert.equal(stack[0], 'Noto Serif SC');
  assert.ok(stack.indexOf('BabelStone Han Extra') > 0);
  assert.equal(stack[stack.length - 1], 'serif');
});

test('扩展 B 区字符 U+20000 落在 BabelStone Han Extra 的 unicode-range 内', () => {
  const blocks = index.split('@font-face').slice(1).filter((b) => b.includes('"BabelStone Han Extra"'));
  const hit = blocks.some((b) => {
    const r = b.match(/unicode-range:\s*U\+([0-9A-F]+)-([0-9A-F]+)/i);
    return r && parseInt(r[1], 16) <= 0x20000 && 0x20000 <= parseInt(r[2], 16);
  });
  assert.ok(hit, 'U+20000 不在任何 BabelStone 分片的 unicode-range 中');
});

test('.md-font-song 规则存在（:::font 宋体 块使用 --chat-font）', () => {
  assert.match(styles, /\.md-font-song\s*\{[^}]*var\(--chat-font/);
});
