// 界面文案覆盖审计（比 scripts/i18n-audit.mjs 更宽）：
//   1. 页面：index.html / app.html / docs.html 里的中文文本节点与 title/aria-label/placeholder；
//   2. 模块：所有 `from './locale.js'` 或 `'./i18n.js'` 的用户界面模块里未包 text()/T()/localeText() 的中文字面量；
//   3. 已知译文来源：js/i18n-packs/<lang>.js、js/ui-catalog.js、js/ui-strings.js。
//
// 用法：
//   node tools/i18n-coverage.mjs            # 人类可读汇总
//   node tools/i18n-coverage.mjs --json     # 机器可读明细（数组）
//   node tools/i18n-coverage.mjs --check    # 只看「必须为零」的界面模块，有遗漏则退出码 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 语言自身的名字按各自语言显示，不属于漏翻
const NATIVE_NAMES = new Set(['中文', '日本語', '한국어', 'English']);
// 模型侧文本（系统提示词、工具描述、子智能体提示、审核词表、任务示例源数据）不是界面文案；
// 它们由 *_en.js / prompt-en.js 等并行模块承载英文版本，或本就只服务中文模型。
const MODEL_FACING = new Set([
  'tools.js', 'tool-catalog.js', 'tool-registry.js', 'config.js', 'prompt.js', 'prompt-core.js', 'prompt-en.js',
  'agent.js', 'subagents.js', 'suggestions.js', 'suggestions-en.js', 'knowledge.js', 'memory.js', 'memorylife.js',
  'moderation-hardening.js', 'local-moderation-lexicons.js', 'nexus.js', 'execution.js', 'executionContext.js',
  'faults.js', 'home-demo.js', 'release-notes.js', 'metrics.js', 'model-catalog.js', 'capabilities.js',
  'audit.js', 'experiments.js', 'i18n.js', 'ui-catalog.js', 'ui-strings.js', 'locale.js', 'docs-language.js',
]);
// 界面文案「必须为零遗漏」的模块：主界面、设置、沙箱预览、附件、人与验证等直接面向用户的部分。
const STRICT_MODULES = [
  'ui.js', 'ui-popovers.js', 'ui-toolflow.js', 'ui-files-panel.js', 'ui-model-picker.js', 'ui-capability.js',
  'ui-attachments.js', 'ui-markdown.js', 'ui-scanner.js', 'settings.js', 'human-check.js', 'quickmap.js',
  'project-mode.js', 'photo-editor.js', 'api.js', 'main.js', 'pricing.js', 'ui-share.js', 'share-document.js',
  'ui-editpreview.js', 'toolwindows.js', 'commandsource.js', 'ui-language.js', 'ui-gateway-key.js', 'checklist.js',
];
// 有意保留的中文：语言切换按钮的本族语名、以及拼接片段（后接变量，由调用处再包一层）。
const ALLOW = new Set([
  '中文', '日本語', '한국어', '暂不支持预览', '地图缩放', '缩小', '放大', '复位',
]);

const known = new Set();
const packDir = path.join(root, 'js/i18n-packs');
for (const f of fs.readdirSync(packDir).filter((x) => x.endsWith('.js') && !['registry.js', 'store.js'].includes(x))) {
  for (const m of read(`js/i18n-packs/${f}`).matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)) known.add(m[1]);
}
for (const m of read('js/ui-catalog.js').matchAll(/\['((?:[^'\\]|\\.)*)',/g)) known.add(m[1]);
for (const m of read('js/ui-strings.js').matchAll(/"((?:[^"\\]|\\.)*)":/g)) known.add(m[1]);

const isKnown = (text) => known.has(text) || ALLOW.has(text) || NATIVE_NAMES.has(text);
const findings = [];
const push = (file, text, line, kind) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || !CJK.test(t) || isKnown(t)) return;
  findings.push({ file, line, kind, text: t.slice(0, 120) });
};

// 1) 页面
for (const page of ['index.html', 'app.html', 'docs.html']) {
  let src = '';
  try { src = read(page); } catch { continue; }
  const stripped = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
  const lineOf = (index) => stripped.slice(0, index).split('\n').length;
  for (const m of stripped.matchAll(/>([^<>]+)</g)) push(page, m[1], lineOf(m.index), 'text');
  for (const m of stripped.matchAll(/\s(?:title|aria-label|placeholder|alt)="([^"]*)"/g)) push(page, m[1], lineOf(m.index), 'attr');
}

// 2) 模块
const modules = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js'));
for (const file of modules) {
  if (MODEL_FACING.has(file)) continue;
  const src = read(`js/${file}`);
  if (!/from '\.\/(?:locale|i18n)\.js/.test(src)) continue;
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const literal = m[1] ?? m[2] ?? m[3] ?? '';
    if (!CJK.test(literal)) continue;
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, m.index);
    if (/^\s*(?:\/\/|\*)/.test(line)) continue;
    const before = src.slice(Math.max(0, m.index - 48), m.index);
    if (/(?:\bT|\bt|\btext|localeText|uiText|localizedText|messageLocaleText|translateUI)\s*\(\s*$/.test(before)) continue;
    const plain = literal.replace(/\\n/g, ' ').trim();
    if (!plain || /[;{}]/.test(plain)) continue;
    // 拼接片段（后面紧跟 + 或 ${）交给调用处统一包一层，单独列为一个「片段」类别
    const after = src.slice(m.index + literal.length, m.index + literal.length + 3);
    const isFragment = /^\s*\+/.test(after) || plain.endsWith('：') || plain.endsWith(': ');
    push(file, plain, src.slice(0, m.index).split('\n').length, isFragment ? 'fragment' : 'literal');
  }
}

const strict = findings.filter((f) => STRICT_MODULES.includes(f.file) && f.kind === 'literal');
const byFile = {};
for (const f of findings) (byFile[f.file] ||= []).push(f);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: findings.length, strict: strict.length, byFile }, null, 1));
} else if (process.argv.includes('--check')) {
  if (strict.length) {
    for (const f of strict) console.error(`${f.file}:${f.line} · ${f.kind} · ${f.text}`);
    console.error(`界面模块仍有 ${strict.length} 条未翻译的写死中文（--check 失败）`);
    process.exitCode = 1;
  } else {
    console.log(`界面模块 0 条写死中文；全站剩余 ${findings.length} 条（文档/拼接片段，见 I18N_GAP_REPORT.md）`);
  }
} else {
  for (const [file, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${file}: ${list.length}`);
  }
  console.log(`total: ${findings.length} · strict(界面模块): ${strict.length}`);
}
