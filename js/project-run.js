// Dubhe Agent · 项目模式段 2：编译 / 运行集成的纯逻辑（不依赖 DOM，可在 node 单测）。
// 运行本身复用沙箱既有运行器（runJavaScript / runPython / runCpp），这里只负责：
// 选择运行器、为 C++ 收集同目录源文件、把报错文本解析成「文件 · 行 · 列」用于跳转。

// js/sandbox.js 的 runJavaScript 用 new Function(...names, body) 包装用户代码，
// 包装头部与两行前置语句共占 4 行：栈里的行号减 4 才是用户代码行号（已用同一包装实测）。
export const JS_LINE_OFFSET = 4;

const RUNNER_BY_EXT = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'cpp',
});
const CPP_SOURCE_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_HEADER_RE = /\.(h|hh|hpp)$/i;

export function runnerFor(path) {
  const name = String(path || '').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return RUNNER_BY_EXT[name.slice(dot + 1).toLowerCase()] || null;
}

export const RUNNER_LABEL = Object.freeze({ javascript: 'JavaScript', python: 'Python', cpp: 'C++' });

/**
 * C++ 多文件：除主文件外，把工作区里的源文件与头文件一并交给编译器。
 * files: { path: content }；返回 runCpp 的 files 选项（compile:false 为仅供 #include 的头文件）。
 */
export function cppSources(files, mainPath) {
  const out = [];
  for (const [path, content] of Object.entries(files || {})) {
    if (path === mainPath || typeof content !== 'string') continue;
    if (CPP_SOURCE_RE.test(path)) out.push({ filename: path, contents: content, compile: true });
    else if (CPP_HEADER_RE.test(path)) out.push({ filename: path, contents: content, compile: false });
  }
  return out;
}

function frameLines(text) {
  return String(text || '').split('\n');
}

/** 解析 JS 栈：<anonymous>:L:C 形式，返回用户代码的行列（忽略落在包装头部的帧）。 */
export function parseJsStack(stack) {
  const hits = [];
  for (const m of String(stack || '').matchAll(/<anonymous>:(\d+):(\d+)/g)) {
    const line = Number(m[1]) - JS_LINE_OFFSET;
    if (line >= 1) hits.push({ line, col: Number(m[2]) });
  }
  return hits;
}

const PY_FRAME_RE = /File "([^"]+)", line (\d+)/g;
const CPP_DIAG_RE = /([\w./\\-]+\.(?:cpp|cc|cxx|c|hpp|hh|h)):(\d+):(\d+):\s*(error|warning|note):\s*(.*)$/;

/**
 * 从运行结果里解析报错位置。activePath：本次运行的文件（JS / Python 的 <exec> 都归到它）。
 * 返回 [{ file, line, col, severity, message }]，去重，保持出现顺序。
 */
export function parseDiagnostics(out, { activePath = '' } = {}) {
  const items = [];
  const seen = new Set();
  const add = (d) => {
    const key = `${d.file}:${d.line}:${d.col}:${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(d);
  };
  const errorMessage = String(out?.error?.message || '');
  const stackText = String(out?.error?.stack || '');
  const logLines = (Array.isArray(out?.logs) ? out.logs : []).map((l) => String(l?.text ?? l ?? ''));
  const texts = [errorMessage, stackText, ...logLines];

  // JS：只看错误栈
  for (const hit of parseJsStack(stackText)) {
    add({ file: activePath, line: hit.line, col: hit.col, severity: 'error', message: firstLine(errorMessage) || 'Error' });
  }

  // Python：Traceback 里 File "<exec>", line N
  const pyText = [errorMessage, ...logLines].join('\n');
  if (/Traceback \(most recent call last\)|SyntaxError|File "/.test(pyText)) {
    let last = null;
    for (const m of pyText.matchAll(PY_FRAME_RE)) {
      const raw = m[1];
      const isMain = raw === '<exec>' || raw === '<string>' || raw === activePath || raw.endsWith(`/${activePath.split('/').pop()}`);
      last = { file: isMain ? activePath : raw, line: Number(m[2]), col: 1 };
    }
    if (last) add({ ...last, severity: 'error', message: lastPyLine(pyText) });
  }

  // C++：clang 诊断 path:line:col: error: message
  for (const t of texts) {
    for (const rawLine of frameLines(t)) {
      const m = rawLine.match(CPP_DIAG_RE);
      if (!m) continue;
      add({ file: m[1].replace(/\\/g, '/'), line: Number(m[2]), col: Number(m[3]), severity: m[4] === 'warning' ? 'warning' : m[4] === 'note' ? 'note' : 'error', message: m[5].trim() });
    }
  }
  return items.filter((d) => d.line >= 1);
}

function firstLine(text) {
  return String(text || '').split('\n').find((l) => l.trim()) || '';
}

function lastPyLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  return lines.length ? lines[lines.length - 1] : 'Python error';
}

/** 给定行号（1 起）返回该行首字符的偏移；越界时夹到末尾。 */
export function lineStartIndex(value, line) {
  const text = String(value || '');
  let idx = 0;
  for (let n = 1; n < line; n++) {
    const next = text.indexOf('\n', idx);
    if (next === -1) return text.length;
    idx = next + 1;
  }
  return idx;
}

/** 运行结束后的摘要文字（不含进度）。 */
export function runSummary(out, lang) {
  const label = RUNNER_LABEL[lang] || lang;
  const ms = Number(out?.durationMs) || 0;
  if (out?.timedOut) return `${label} · 超时（${Math.round(ms / 100) / 10}s）`;
  if (out?.aborted) return `${label} · 已停止`;
  return `${label} · ${out?.ok ? '成功' : '失败'} · ${ms} ms`;
}
