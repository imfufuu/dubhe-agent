// 语言包审计：扫描对话页（app.html + js/ui*.js 等）中的中文界面字符串，
// 找出既没有 text(zh,en) 双语写法、也没有登记到语言包（UI_CATALOG / UI_STRINGS / registerLanguagePack）的条目。
// 用法：node scripts/i18n-audit.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const SKIP_CALL = /(?:localeText|text|t|translateUI)\s*\(\s*$/;

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const jsFiles = fs.readdirSync(path.join(root, 'js'))
  .filter((f) => /^(ui|toolflow|toolwindows|checklist)[\w-]*\.js$/.test(f) && !['ui-strings.js', 'ui-catalog.js'].includes(f))
  .map((f) => `js/${f}`);

// 已登记的源文本：语言包目录下所有 registerLanguagePack / UI_CATALOG / UI_STRINGS 的键
const registered = new Set();
const catalogSrc = read('js/ui-catalog.js');
for (const m of catalogSrc.matchAll(/\['((?:[^'\\]|\\.)*)',/g)) registered.add(m[1]);
for (const m of read('js/ui-strings.js').matchAll(/"((?:[^"\\]|\\.)*)":/g)) registered.add(m[1]);
const packDir = path.join(root, 'js/i18n-packs');
if (fs.existsSync(packDir)) for (const f of fs.readdirSync(packDir)) {
  for (const m of read(`js/i18n-packs/${f}`).matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)) registered.add(m[1]);
}

const findings = [];
// 语言自身的名称（中文 / 日本語 / 한국어）按各自语言显示，不属于漏翻
const NATIVE_NAMES = new Set(['中文', '日本語', '한국어']);
const decode = (v) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// 1) 静态 HTML：文本节点与 title/aria-label/placeholder
const html = read('app.html').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
for (const m of html.matchAll(/>([^<>]+)</g)) {
  const s = decode(m[1].trim());
  if (s && CJK.test(s) && !registered.has(s) && !NATIVE_NAMES.has(s)) findings.push({ file: 'app.html', text: s });
}
for (const m of html.matchAll(/\s(?:title|aria-label|placeholder)="([^"]*)"/g)) {
  const s = m[1].trim();
  if (CJK.test(s) && !registered.has(s)) findings.push({ file: 'app.html', attr: true, text: s });
}
// 2) JS 字符串字面量（排除 text()/localeText() 的中文首参、注释行）
for (const rel of jsFiles) {
  const src = read(rel);
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '');
    if (!CJK.test(s)) continue;
    const before = src.slice(Math.max(0, m.index - 40), m.index);
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (src.slice(lineStart, m.index).trimStart().startsWith('//')) continue;
    if (SKIP_CALL.test(before)) continue;
    if (/(?:localeText|text|t)\(\s*$/.test(before)) continue;
    // 含 HTML 的模板片段：只检查标签之间的文本节点（属性值由 DOM 翻译器单独处理）
    if (s.includes('<')) {
      for (const seg of s.matchAll(/>([^<>]+)</g)) {
        const txt = seg[1].replace(/\s+/g, ' ').trim();
        if (txt && CJK.test(txt) && !/[${}]/.test(txt) && !registered.has(txt) && !NATIVE_NAMES.has(txt)) findings.push({ file: rel, line: src.slice(0, m.index).split('\n').length, text: txt });
      }
      continue;
    }
    const plain = s.replace(/\\n/g, ' ').trim();
    // 代码片段（分号、花括号、行注释）不是界面文本
    if (!plain || /[;{}]|^\/\//.test(plain) || registered.has(plain) || NATIVE_NAMES.has(plain)) continue;
    findings.push({ file: rel, line: src.slice(0, m.index).split('\n').length, text: plain.slice(0, 80) });
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 1));
else if (!process.argv.includes('--todo')) {
  const byFile = {};
  for (const f of findings) (byFile[f.file] ||= []).push(f);
  for (const [file, list] of Object.entries(byFile)) console.log(`${file}: ${list.length}`);
  console.log(`total unregistered CJK UI strings: ${findings.length}`);
}

// --todo：列出 text()/uiText() 首参中尚未登记到语言包的中文源文本（这些在非中英语言下会回退英文）
if (process.argv.includes('--todo')) {
  const pat = /(?:localeText|text|uiText|localizedText|messageLocaleText)\(\s*(['"`])((?:(?!\1).)*?)\1\s*,/g;
  const todo = new Set();
  for (const rel of jsFiles) {
    for (const m of read(rel).matchAll(pat)) {
      const s = m[2].trim();
      if (CJK.test(s) && !registered.has(s)) todo.add(s);
    }
  }
  console.log(JSON.stringify([...todo], null, 1));
}
