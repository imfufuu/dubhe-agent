#!/usr/bin/env node
// 生成「懒加载字体」资产（assets/fonts-lazy/）。
// 来源（版本已固定，许可证见各包 LICENSE）：
//   @fontsource/noto-sans-jp|kr|sc|serif-sc 5.3.1、@fontsource/noto-naskh-arabic 5.3.0、
//   @fontsource/noto-sans-hebrew 5.3.0、@fontsource/noto-sans-thai 5.3.0、@fontsource/noto-sans-devanagari 5.3.0（OFL）
//   @free-fonts/babelstone-han 1.1.0 的 Extra 字族（扩展 B–J 区；MIT AND Arphic-1999）
// 用法：node scripts/vendor-lazy-fonts.mjs   （需要能访问 npm 注册表）
// 产物：assets/fonts-lazy/index.css + 各字族 woff2 + licenses/。浏览器按 unicode-range 只下载用到的分片。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'assets/fonts-lazy');
const work = mkdtempSync(path.join(tmpdir(), 'lazyfonts-'));

// 码位 < U+0590 的子集（拉丁、希腊、西里尔、越南语等）由系统字体承担，不随应用分发
const MIN_CODEPOINT = 0x0590;

const FONTSOURCE = [
  { id: 'sans-jp', pkg: '@fontsource/noto-sans-jp', version: '5.3.1', family: 'Noto Sans JP' },
  { id: 'sans-kr', pkg: '@fontsource/noto-sans-kr', version: '5.3.1', family: 'Noto Sans KR' },
  { id: 'sans-sc', pkg: '@fontsource/noto-sans-sc', version: '5.3.1', family: 'Noto Sans SC' },
  // 宋体风格（思源宋体）：Agent 输出正文所用的衬线中文字族，全平台一致，不依赖系统宋体
  { id: 'serif-sc', pkg: '@fontsource/noto-serif-sc', version: '5.3.1', family: 'Noto Serif SC' },
  { id: 'arabic', pkg: '@fontsource/noto-naskh-arabic', version: '5.3.0', family: 'Noto Naskh Arabic' },
  { id: 'hebrew', pkg: '@fontsource/noto-sans-hebrew', version: '5.3.0', family: 'Noto Sans Hebrew' },
  { id: 'thai', pkg: '@fontsource/noto-sans-thai', version: '5.3.0', family: 'Noto Sans Thai' },
  { id: 'devanagari', pkg: '@fontsource/noto-sans-devanagari', version: '5.3.0', family: 'Noto Sans Devanagari' },
];
const BABELSTONE = { id: 'han-ext', pkg: '@free-fonts/babelstone-han', version: '1.1.0', family: 'BabelStone Han Extra' };

function fetchPackage(pkg, version) {
  const dir = mkdtempSync(path.join(work, 'p-'));
  const tgz = execFileSync('npm', ['pack', `${pkg}@${version}`, '--pack-destination', dir, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['-xzf', path.join(dir, tgz), '-C', dir]);
  return path.join(dir, 'package');
}

// 把 @font-face 块拆出来：返回 { family, range, file, block }
function faces(css) {
  return [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]).map((block) => ({
    family: /font-family:\s*'([^']+)'/.exec(block)?.[1],
    range: /unicode-range:\s*([^;]+);/.exec(block)?.[1].trim(),
    weight: /font-weight:\s*(\d+)/.exec(block)?.[1],
    src: /url\(['"]?([^'")]+\.woff2)['"]?\)/.exec(block)?.[1],
    block,
  })).filter((f) => f.src && f.range);
}

function rangeKeepable(range) {
  // 任一段的终点 >= MIN_CODEPOINT 即保留（跨越边界的段也保留）
  return range.split(',').some((seg) => {
    const hi = seg.trim().split('-').pop();
    return parseInt(hi.replace(/^U\+/i, ''), 16) >= MIN_CODEPOINT;
  });
}

const rules = [];
const licenses = [];
mkdirSync(path.join(outDir, 'licenses'), { recursive: true });

for (const f of FONTSOURCE) {
  const pkgDir = fetchPackage(f.pkg, f.version);
  const css = readFileSync(path.join(pkgDir, '400.css'), 'utf8');
  const target = path.join(outDir, f.id);
  mkdirSync(target, { recursive: true });
  let kept = 0;
  for (const face of faces(css)) {
    if (!rangeKeepable(face.range)) continue;
    const name = path.basename(face.src);
    copyFileSync(path.join(pkgDir, 'files', name), path.join(target, name));
    rules.push(`@font-face {\n  font-family: "${f.family}";\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url("./${f.id}/${name}") format("woff2");\n  unicode-range: ${face.range};\n}`);
    kept++;
  }
  licenses.push(`${f.id}: ${f.pkg}@${f.version} (${kept} 个分片)`);
  copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'licenses', `${f.id}-LICENSE.txt`));
}

{
  const pkgDir = fetchPackage(BABELSTONE.pkg, BABELSTONE.version);
  const css = readFileSync(path.join(pkgDir, 'babelstone-han.css'), 'utf8');
  const target = path.join(outDir, BABELSTONE.id);
  mkdirSync(target, { recursive: true });
  let kept = 0;
  for (const face of faces(css)) {
    if (face.family !== BABELSTONE.family) continue;
    if (!rangeKeepable(face.range)) continue;
    const name = path.basename(face.src);
    copyFileSync(path.join(pkgDir, 'fonts', name), path.join(target, name));
    rules.push(`@font-face {\n  font-family: "${BABELSTONE.family}";\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url("./${BABELSTONE.id}/${name}") format("woff2");\n  unicode-range: ${face.range};\n}`);
    kept++;
  }
  licenses.push(`${BABELSTONE.id}: ${BABELSTONE.pkg}@${BABELSTONE.version} Extra 字族 (${kept} 个分片)`);
  copyFileSync(path.join(pkgDir, 'LICENSE'), path.join(outDir, 'licenses', `${BABELSTONE.id}-LICENSE.txt`));
}

const header = [
  '/* 懒加载字体（自动生成，勿手改）：scripts/vendor-lazy-fonts.mjs',
  ' * 浏览器只在页面出现对应字符时下载分片（unicode-range）。',
  ...licenses.map((l) => ` *   ${l}`),
  ' */',
].join('\n');
writeFileSync(path.join(outDir, 'index.css'), `${header}\n\n${rules.join('\n\n')}\n`);
writeFileSync(path.join(outDir, 'licenses/README.txt'), `各字族许可证文本见本目录；来源包与版本见 index.css 头部。\n${licenses.join('\n')}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`assets/fonts-lazy 已生成：${rules.length} 个 @font-face 分片`);
