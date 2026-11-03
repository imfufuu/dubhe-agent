// Markdown 排版扩展（渐变 / 动效 / 微交互 / 十六进制颜色）与懒加载字体筛选的单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fx from '../js/md-fx.js';
import { selectLazyFaces, codepointsOf, parseFontFaces } from '../js/lazy-fonts.js';
import { renderMarkdown } from '../js/ui-markdown.js';

test('颜色：只接受严格的 #hex，3 位自动展开并小写', () => {
  assert.equal(fx.hexColor('#FFF'), '#ffffff');
  assert.equal(fx.hexColor('#A1b2C3'), '#a1b2c3');
  for (const bad of ['red', '#12', '#gggggg', 'javascript:1', '#ff0000;background:url(x)']) assert.equal(fx.hexColor(bad), null, bad);
});

test('渐变：预设、颜色列表与角度；非法输入返回 null', () => {
  assert.equal(fx.gradientCss('sunset'), 'linear-gradient(90deg, #ff7a18, #af002d, #ff3d7f)');
  assert.equal(fx.gradientCss('#f00 → #00f 45deg'), 'linear-gradient(45deg, #ff0000, #0000ff)');
  assert.equal(fx.gradientCss('#f00 #0f0 #00f 720'), 'linear-gradient(360deg, #ff0000, #00ff00, #0000ff)', '角度夹紧到 0–360');
  assert.equal(fx.gradientCss('#f00'), null, '至少两个颜色');
  assert.equal(fx.gradientCss('#f00 #0f0 #00f #fff #000'), null, '最多四个颜色');
  assert.equal(fx.gradientCss('url(x) #f00 #0f0'), null);
});

test('颜色对比度：按主题分别修正，两种背景都达到 4.5:1', () => {
  const pair = fx.colorPairFor('#ffd200');
  assert.ok(pair, '黄色也能找到可读配对');
  assert.ok(fx.contrastRatio(pair.light, fx.THEME_BACKGROUNDS[0]) >= 4.5);
  assert.ok(fx.contrastRatio(pair.dark, fx.THEME_BACKGROUNDS[1]) >= 4.5);
  assert.equal(fx.colorStyleFor('#777'), '--md-c-light:#000000;--md-c-dark:#7e7e7e'.replace('#000000', fx.colorPairFor('#777').light).replace('#7e7e7e', fx.colorPairFor('#777').dark));
  assert.equal(fx.colorStyleFor('nope'), null);
});

test('动效与微交互名称：英文与中文别名，未知名称返回 null', () => {
  assert.equal(fx.fxKind('wave'), 'wave');
  assert.equal(fx.fxKind('闪光'), 'shimmer');
  assert.equal(fx.fxKind('custom'), 'custom');
  assert.equal(fx.fxKind('evil'), null);
  assert.equal(fx.cardKind('ripple'), 'ripple');
  assert.equal(fx.cardKind('涟漪'), 'ripple');
  assert.equal(fx.cardKind('spin'), null);
});

test('自定义 CSS 净化：拒绝 url / @import / 变量 / 转义 / 定位，选择器限定在块内', () => {
  const r = fx.sanitizeCustomCss(`
@keyframes pulse { 0% { opacity: .2 } 100% { opacity: 1; background: url(x) } }
& { color: #123456; animation: pulse 2s infinite; background-image: url(evil.png); }
&::after { background: #f00 }
div span { color: red }
@import url(x);
&:hover { transform: rotate(3deg); position: fixed; color: var(--fg) }
</style><script>alert(1)</script>`);
  assert.ok(r, '仍有可用规则');
  assert.match(r.css, /\.md-fx-c[a-z0-9]+ \{ color: #123456; animation: md-fx-c[a-z0-9]+-pulse 2s infinite \}/);
  assert.match(r.css, /\.md-fx-c[a-z0-9]+::after \{ background: #f00 \}/, '伪元素允许');
  assert.doesNotMatch(r.css, /url|import|evil|var\(|position|fixed|script|alert|div span|<|>|\\/i);
  assert.match(r.css, /@keyframes md-fx-c[a-z0-9]+-pulse \{ 0% \{ opacity: \.2 \} 100% \{ opacity: 1 \} \}/);
  assert.equal(fx.sanitizeCustomCss('@import url(x); div { color: red }'), null, '全部被拒绝时返回 null');
  assert.equal(fx.sanitizeCustomCss('& { color: red'), null, '括号不平衡');
});

test('块渲染：合法参数生成结构，非法参数保留原文，自定义 CSS 缺失时降级为普通容器', () => {
  const html = renderMarkdown(':::gradient sunset\n渐变标题\n:::\n\n:::card lift\n卡片\n:::\n\n:::fx shimmer\n闪光\n:::');
  assert.match(html, /<div class="md-gradient" style="--md-grad:linear-gradient\(90deg, #ff7a18/);
  assert.match(html, /<div class="md-card md-card-lift">/);
  assert.match(html, /<div class="md-fx md-fx-shimmer">/);
  const bad = renderMarkdown(':::gradient javascript:alert(1)\n不应渲染\n:::');
  assert.doesNotMatch(bad, /md-gradient/);
  assert.match(bad, /不应渲染/);
  const plain = renderMarkdown(':::fx custom\n@import url(x);\n===\n正文保留\n:::');
  assert.match(plain, /<div class="md-fx">/);
  assert.match(plain, /正文保留/);
});

test('自定义动效块：CSS 写在 === 之上、只在块内生效，正文仍走 Markdown', () => {
  const html = renderMarkdown(':::fx custom\n@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }\n& { animation: spin 2s linear infinite }\n===\n**正文**\n:::');
  assert.match(html, /<div class="md-fx md-fx-custom md-fx-c[a-z0-9]+"><style>/);
  assert.match(html, /正文/);
  assert.doesNotMatch(html, /===/);
});

test('十六进制颜色块：可读则输出按主题变量的样式，否则不替换', () => {
  const html = renderMarkdown(':::color #2a6fdb\n蓝字\n:::');
  assert.match(html, /<div class="md-color md-color-hex" style="--md-c-light:#[0-9a-f]{6};--md-c-dark:#[0-9a-f]{6}">/);
  assert.match(renderMarkdown(':::color red\n红字\n:::'), /md-c-red/, '命名颜色保持原行为');
});

test('懒加载字体：按码位筛选分片；拉丁字符不触发分片', () => {
  const css = [
    "@font-face { font-family: 'A'; src: url(./a/one.woff2) format('woff2'); unicode-range: U+4E00-4EFF; }",
    "@font-face { font-family: 'A'; src: url(./a/two.woff2) format('woff2'); unicode-range: U+20000-200FF; }",
    "@font-face { font-family: 'A'; src: url(./a/latin.woff2) format('woff2'); unicode-range: U+0000-00FF; }",
  ].join('\n');
  assert.deepEqual(parseFontFaces(css).map((f) => f.url), ['./a/one.woff2', './a/two.woff2', './a/latin.woff2']);
  assert.deepEqual(selectLazyFaces(css, [0x4e2d, 0x41]).map((f) => f.url), ['./a/one.woff2']);
  assert.deepEqual(selectLazyFaces(css, [0x20001]).map((f) => f.url), ['./a/two.woff2'], '非基本平面字符命中扩展分片');
  assert.deepEqual(selectLazyFaces(css, [0x41, 0x42]), [], '纯拉丁不下载任何分片');
  assert.deepEqual(codepointsOf('a中𠀀'), [0x4e2d, 0x20000]);
});

test('懒加载索引：各字族存在且分片文件都已入库', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const css = fs.readFileSync(path.join(root, 'assets/fonts-lazy/index.css'), 'utf8');
  for (const family of ['Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC', 'Noto Naskh Arabic', 'Noto Sans Hebrew', 'Noto Sans Thai', 'Noto Sans Devanagari', 'BabelStone Han Extra']) {
    assert.match(css, new RegExp(`font-family: "${family}"`), family);
  }
  const faces = parseFontFaces(css);
  assert.ok(faces.length > 600, `分片数 ${faces.length}`);
  for (const f of faces) assert.ok(fs.existsSync(path.join(root, 'assets/fonts-lazy', f.url)), f.url);
});

test('占位符没有对应块时不抛异常（挂载界面时整页无法打开的回归）', () => {
  // 文本里偶然出现的私用区占位符（如 \uE000ALIGN0\uE000、\uE000FOLD3\uE000、\uE000CHART2\uE000）曾让
  // alignAt / foldAt / chartAt 读取 undefined 的属性而抛错，挂载时一条历史消息即可让界面打不开。
  for (const tok of ['\uE000ALIGN0\uE000', '\uE000FOLD3\uE000', '\uE000FONT1\uE000', '\uE000COLOR2\uE000',
    '\uE000FXB4\uE000', '\uE000CHART2\uE000', '\uE000DIAGRAM5\uE000', '\uE000FILE6\uE000', '\uE000IC7\uE000', '\uE000CHOICE8\uE000']) {
    assert.doesNotThrow(() => renderMarkdown(`前缀 ${tok} 后缀`), tok);
    assert.doesNotMatch(String(renderMarkdown(`前缀 ${tok} 后缀`)), /\uE000/, `${tok} 不应以原样输出到页面`);
  }
  assert.match(renderMarkdown('正常段落'), /正常段落/);
});

test('已删除「输出碰到长度上限，未写完」提示（界面与所有语言包）', async () => {
  const fs = (await import('node:fs')).default;
  const phrase = '输出碰到长度上限';
  const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.equal(ui.includes(phrase), false);
  const packs = fs.readdirSync(new URL('../js/i18n-packs/', import.meta.url));
  for (const f of packs) assert.equal(fs.readFileSync(new URL(`../js/i18n-packs/${f}`, import.meta.url), 'utf8').includes(phrase), false, f);
});

// 单行写法：用户与模型常把整段写在开头行（`:::gradient ocean 120 正文 :::`），应当渲染而不是原样输出
test('渐变：预设可带角度，预设名后紧跟颜色时以颜色为准', () => {
  assert.equal(fx.gradientCss('ocean 120'), 'linear-gradient(120deg, #2193b0, #6dd5ed)');
  assert.equal(fx.gradientCss('forest #1f4037 #99f2c8 90'), 'linear-gradient(90deg, #1f4037, #99f2c8)');
});

test('单行围栏：参数取开头合法记号，其余为正文；非法参数返回 null', () => {
  assert.deepEqual(fx.splitInlineFence('gradient', 'ocean 120 海洋渐变 · 到指定角度 120°'), { arg: 'ocean 120', body: '海洋渐变 · 到指定角度 120°' });
  assert.deepEqual(fx.splitInlineFence('gradient', '#ff7a18 #af002d 45 正文'), { arg: '#ff7a18 #af002d 45', body: '正文' });
  assert.deepEqual(fx.splitInlineFence('fx', 'shimmer 闪光标题'), { arg: 'shimmer', body: '闪光标题' });
  assert.equal(fx.splitInlineFence('fx', 'custom 不行'), null);
  assert.equal(fx.splitInlineFence('gradient', '不是参数的正文'), null);
});

test('单行渐变围栏：渲染为渐变块，正文保留，不残留 ::: 原文', () => {
  const html = renderMarkdown(':::gradient ocean 120 海洋渐变 · 到指定角度 120° :::\n\n正文段落');
  assert.match(html, /md-gradient/);
  assert.match(html, /linear-gradient\(120deg/);
  assert.match(html, /海洋渐变/);
  assert.doesNotMatch(html, /:::/);
});

test('单行渐变围栏：流式未闭合补全不会对已闭合的单行块多补一个 :::', () => {
  const html = renderMarkdown(':::gradient sunset 日落标题 :::', { streaming: true });
  assert.doesNotMatch(html, /:::/);
  assert.match(html, /md-gradient/);
});
