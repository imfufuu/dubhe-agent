// 西夏文字体：远程 TTF 为主源、本地 Wenhai 分片为回退，离线分享仍可内嵌。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFontFaces, codepointsOf } from '../js/lazy-fonts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TANGUT_URL = 'https://litter.catbox.moe/t8rntt.ttf';
const sheets = ['assets/fonts-lazy/index.css', 'assets/fonts-lazy/babelstone-extra.css'];

test('西夏文 @font-face 使用指定远程字体，并保留本地回退', () => {
  for (const rel of sheets) {
    const css = fs.readFileSync(path.join(root, rel), 'utf8');
    const face = css.split('@font-face').find((b) => b.includes('"BabelStone Tangut Wenhai"'));
    assert.ok(face, `${rel} 缺少西夏文 face`);
    assert.ok(face.includes(TANGUT_URL), `${rel} 未引用指定 TTF`);
    assert.ok(face.includes('./babelstone/wenhai.woff2'), `${rel} 缺少本地回退`);
    assert.ok(face.includes('./babelstone/tangut-yinchuan.ttf'), `${rel} 缺少完整字体本地副本`);
    assert.ok(face.indexOf(TANGUT_URL) < face.indexOf('./babelstone/tangut-yinchuan.ttf'), '远程字体必须是首选');
    assert.ok(face.indexOf('./babelstone/tangut-yinchuan.ttf') < face.indexOf('./babelstone/wenhai.woff2'), '完整副本优先于旧分片');
    assert.match(face, /U\+17000-18AFF/, '西夏文 unicode-range 不能丢失');
  }
  const styles = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
  assert.match(styles, /\.md-font-tangut \{ font-family: "BabelStone Tangut Wenhai"/);
});

test('随仓库分发的完整字体副本有效，临时托管过期也不会退化', () => {
  const f = path.join(root, 'assets/fonts-lazy/babelstone/tangut-yinchuan.ttf');
  const buf = fs.readFileSync(f);
  assert.ok(buf.length > 5 * 1024 * 1024, '完整 TTF 副本不应被截断');
  assert.deepEqual([...buf.subarray(0, 4)], [0x00, 0x01, 0x00, 0x00], '必须是 TrueType sfnt');
});

test('懒加载解析器选择可内嵌的本地字体，分享导出不依赖第三方主机', () => {
  const css = fs.readFileSync(path.join(root, 'assets/fonts-lazy/index.css'), 'utf8');
  const tangut = parseFontFaces(css).filter((f) => f.block.includes('"BabelStone Tangut Wenhai"'));
  assert.equal(tangut.length, 1);
  assert.equal(tangut[0].url, './babelstone/wenhai.woff2');
  assert.ok(tangut[0].urls.includes(TANGUT_URL));
  assert.ok(fs.existsSync(path.join(root, 'assets/fonts-lazy', tangut[0].url)));
  // 西夏文码位仍命中该分片
  const cps = codepointsOf('𗎠𘀀');
  assert.ok(tangut[0].ranges.some(([lo, hi]) => cps.some((c) => c >= lo && c <= hi)));
});

test('全部懒加载分片仍是本地可读文件（远程主源不破坏清单）', () => {
  const css = fs.readFileSync(path.join(root, 'assets/fonts-lazy/index.css'), 'utf8');
  const faces = parseFontFaces(css);
  assert.ok(faces.length > 600);
  for (const f of faces) assert.ok(fs.existsSync(path.join(root, 'assets/fonts-lazy', f.url)), f.url);
});
