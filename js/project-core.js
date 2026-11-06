// Dubhe Agent · 项目模式的纯逻辑（第 17 条）：路径、语言、编辑器的缩进 / 回车 / 行列计算。
// 不依赖 DOM，可在 node 里单测；UI 在 project-mode.js。
import { buildFileTree, flattenTree } from './filetree.js';

export const PROJECT_RESERVED_PREFIXES = Object.freeze(['internal/', '.git/']);
export const PROJECT_INDENT = '  ';
export const PROJECT_MAX_NAME = 120;
export const PROJECT_RENDER_LINE_CAP = 20000;

/** 工作区路径：相对、无空段、无 `..`、不落在内部目录里。 */
export function isWorkspacePath(path) {
  const p = String(path || '');
  if (!p || p.startsWith('/') || p.startsWith('\\') || p.includes('\0') || p.includes('\\')) return false;
  const parts = p.split('/');
  if (parts.some((s) => !s || s === '.' || s === '..')) return false;
  return !PROJECT_RESERVED_PREFIXES.some((pref) => p.startsWith(pref));
}

/** 从 store.state.files（path → content）取出工作区文件列表，按路径排序。 */
export function workspaceEntries(files) {
  return Object.keys(files || {})
    .filter(isWorkspacePath)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((path) => ({ path, size: contentSize(files[path]) }));
}

function contentSize(content) {
  return typeof content === 'string' ? content.length : 0;
}

/** data: URL 与含 NUL 的内容视为二进制，不在文本编辑器里打开。 */
export function isBinaryContent(content) {
  const s = String(content == null ? '' : content);
  if (s.startsWith('data:')) return true;
  return s.slice(0, 4096).includes('\0');
}

const LANGUAGE_BY_EXT = Object.freeze({
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript',
  py: 'Python', c: 'C', h: 'C', cc: 'C++', cpp: 'C++', hpp: 'C++', cxx: 'C++',
  html: 'HTML', htm: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', markdown: 'Markdown',
  sh: 'Shell', yml: 'YAML', yaml: 'YAML', toml: 'TOML', xml: 'XML', svg: 'SVG',
  txt: 'Text', csv: 'CSV', go: 'Go', rs: 'Rust', java: 'Java', sql: 'SQL',
});

export function languageOf(path) {
  const name = String(path || '').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name === 'Makefile' ? 'Makefile' : 'Text';
  return LANGUAGE_BY_EXT[name.slice(dot + 1).toLowerCase()] || 'Text';
}

/** 行号（1 起）与列号（1 起）。pos 为字符偏移。 */
export function lineCol(value, pos) {
  const text = String(value || '');
  const p = Math.max(0, Math.min(Number(pos) || 0, text.length));
  let line = 1;
  for (let i = 0; i < p; i++) if (text.charCodeAt(i) === 10) line++;
  const lineStart = p === 0 ? 0 : text.lastIndexOf('\n', p - 1) + 1;
  return { line, col: p - lineStart + 1 };
}

export function lineCount(value) {
  const text = String(value || '');
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function lineStartOf(value, pos) {
  return pos <= 0 ? 0 : value.lastIndexOf('\n', pos - 1) + 1;
}

function lineEndOf(value, pos) {
  const i = value.indexOf('\n', pos);
  return i === -1 ? value.length : i;
}

/**
 * Tab / Shift+Tab。无选区且不是反缩进：在光标处插入一个缩进单位。
 * 有选区：选中的整行增减缩进，选区随之保持覆盖这些行。
 */
export function indentEdit(value, start, end, { dedent = false, unit = PROJECT_INDENT } = {}) {
  const text = String(value || '');
  const s = Math.max(0, Math.min(start, end));
  const e = Math.max(0, Math.max(start, end));
  if (s === e && !dedent) {
    return { value: text.slice(0, s) + unit + text.slice(e), start: s + unit.length, end: s + unit.length };
  }
  const ls = lineStartOf(text, s);
  const le = lineEndOf(text, e);
  const lines = text.slice(ls, le).split('\n');
  let firstDelta = 0;
  let total = 0;
  const out = lines.map((line, idx) => {
    if (!dedent) {
      if (idx === 0) firstDelta = unit.length;
      total += unit.length;
      return unit + line;
    }
    let remove = 0;
    if (line.startsWith('\t')) remove = 1;
    else while (remove < unit.length && line[remove] === ' ') remove++;
    if (idx === 0) firstDelta = -remove;
    total -= remove;
    return line.slice(remove);
  });
  const block = out.join('\n');
  const nextValue = text.slice(0, ls) + block + text.slice(le);
  const nextStart = Math.max(ls, s + firstDelta);
  return { value: nextValue, start: nextStart, end: Math.max(nextStart, e + total) };
}

/** 回车：保持当前行缩进；行尾是开括号或冒号时多缩进一级。 */
export function enterEdit(value, start, end, { unit = PROJECT_INDENT } = {}) {
  const text = String(value || '');
  const s = Math.max(0, Math.min(start, end));
  const e = Math.max(0, Math.max(start, end));
  const ls = lineStartOf(text, s);
  const currentLine = text.slice(ls, s);
  const indent = (currentLine.match(/^[ \t]*/) || [''])[0];
  const before = text.slice(0, s).trimEnd();
  const opens = /[{(\[:]$/.test(before);
  const insert = '\n' + indent + (opens ? unit : '');
  return { value: text.slice(0, s) + insert + text.slice(e), start: s + insert.length, end: s + insert.length };
}

/** 新建 / 重命名的名字校验：单段、不含非法字符、不是 . 或 .. */
export function validateName(name) {
  const n = String(name || '').trim();
  if (!n) return { ok: false, error: '名称不能为空' };
  if (n.length > PROJECT_MAX_NAME) return { ok: false, error: `名称不能超过 ${PROJECT_MAX_NAME} 个字符` };
  if (n === '.' || n === '..' || /[\/\\\0]/.test(n)) return { ok: false, error: '名称不能包含 / \\ 或为 . ..' };
  return { ok: true, name: n };
}

export function joinPath(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

export function parentDir(path) {
  const i = String(path || '').lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** 资源管理器的扁平树（目录在 collapsed 集合中时不展开子项）。 */
export function explorerRows(entries, collapsed = new Set()) {
  return flattenTree(buildFileTree(entries), { isCollapsed: (p) => collapsed.has(p) });
}

/** Plan a workspace copy/move without overwriting or writing through a file. */
export function planWorkspaceTransfer(files, source, destination, { copy = false } = {}) {
  const snap = files || {};
  const from = String(source || ''), dir = String(destination || '').replace(/\/$/, '');
  if (!isWorkspacePath(from) || (dir && !isWorkspacePath(dir))) return { ok: false, error: '非法路径' };
  const paths = Object.keys(snap).filter(p => p === from || p.startsWith(from + '/'));
  if (!paths.length) return { ok: false, error: '源文件不存在' };
  if (dir === from || dir.startsWith(from + '/')) return { ok: false, error: '不能移动或复制到自身或子目录' };
  if (dir && !Object.keys(snap).some(p => p.startsWith(dir + '/'))) return { ok: false, error: '目标目录不存在' };
  const base = from.split('/').pop();
  let target = joinPath(dir, base);
  if (!copy && target === from) return { ok: false, error: '源和目标相同' };
  const conflicts = (root) => Object.keys(snap).some(p => p === root || p.startsWith(root + '/') || root.startsWith(p + '/'));
  if (copy && target === from) {
    const dot = base.lastIndexOf('.'), stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
    let n = 1;
    do { target = joinPath(dir, `${stem} copy${n === 1 ? '' : ' ' + n}${ext}`); n++; } while (conflicts(target) && n < 10000);
  }
  if (!isWorkspacePath(target) || conflicts(target)) return { ok: false, error: '目标已存在或路径不可用' };
  return { ok: true, from, target, paths, entries: paths.map(path => ({ from: path, to: target + path.slice(from.length), value: snap[path] })) };
}
