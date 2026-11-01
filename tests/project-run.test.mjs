// 项目模式段 2：运行器选择、C++ 多文件、报错位置解析（JS / Python / C++）、跳转偏移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JS_LINE_OFFSET, runnerFor, cppSources, parseJsStack, parseDiagnostics, lineStartIndex, runSummary,
} from '../js/project-run.js';

test('runnerFor maps file extensions to the existing sandbox runners', () => {
  assert.equal(runnerFor('a/b.js'), 'javascript');
  assert.equal(runnerFor('x.MJS'), 'javascript');
  assert.equal(runnerFor('main.py'), 'python');
  assert.equal(runnerFor('src/main.cpp'), 'cpp');
  assert.equal(runnerFor('old.c'), 'cpp');
  assert.equal(runnerFor('index.html'), null);
  assert.equal(runnerFor('README'), null);
  assert.equal(runnerFor('.bashrc'), null);
});

test('cppSources takes other sources and headers, never the main file', () => {
  const files = { 'main.cpp': 'int main(){}', 'util.cpp': 'void u(){}', 'util.h': '#pragma once', 'notes.md': 'x', 'bin.png': 'data:' };
  const got = cppSources(files, 'main.cpp');
  assert.deepEqual(got.map((f) => [f.filename, f.compile]), [['util.cpp', true], ['util.h', false]]);
});

test('JS stack line offset matches the runtime wrapper used by js/sandbox.js', async () => {
  // 与 worker-js.js 的兜底包装一致：new Function + async 箭头体；用户第 3 行报错应映射为 3
  const code = 'const a = 1;\nconsole.log(a);\nthrow new Error("boom");';
  const fn = new Function('console', '"use strict";\nreturn (async () => {\n' + code + '\n})();');
  let stack = '';
  try { await fn(console); } catch (e) { stack = e.stack; }
  const hits = parseJsStack(stack);
  assert.equal(JS_LINE_OFFSET, 4);
  assert.equal(hits[0].line, 3, JSON.stringify(hits));
});

test('JS: a thrown error inside user code maps to the user line', () => {
  const stack = 'Error: boom\n    at eval (eval at <anonymous> (x.js:2:13), <anonymous>:7:7)';
  const items = parseDiagnostics({ ok: false, error: { message: 'boom', stack }, logs: [] }, { activePath: 'calc.js' });
  assert.deepEqual(items, [{ file: 'calc.js', line: 3, col: 7, severity: 'error', message: 'boom' }]);
});

test('JS: frames inside the wrapper header are ignored', () => {
  assert.deepEqual(parseJsStack('at <anonymous>:2:5'), []);
});

test('Python: traceback points at the last <exec> frame', () => {
  const text = 'Traceback (most recent call last):\n  File "<exec>", line 2, in <module>\n  File "<exec>", line 5, in f\nZeroDivisionError: division by zero';
  const items = parseDiagnostics({ ok: false, error: { message: text }, logs: [] }, { activePath: 'app.py' });
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].file, items[0].line, items[0].message], ['app.py', 5, 'ZeroDivisionError: division by zero']);
});

test('Python: syntax error from logs keeps the reported line', () => {
  const logs = [{ level: 'error', text: '  File "<exec>", line 3\n    x = (1 +\n' }, { level: 'error', text: 'SyntaxError: invalid syntax' }];
  const items = parseDiagnostics({ ok: false, error: { message: 'SyntaxError: invalid syntax' }, logs }, { activePath: 'bad.py' });
  assert.equal(items[0].line, 3);
  assert.equal(items[0].file, 'bad.py');
});

test('C++: clang diagnostics keep file, line, column and severity', () => {
  const logs = [
    { level: 'error', text: 'util.cpp:4:9: warning: unused variable' },
    { level: 'error', text: 'main.cpp:12:5: error: use of undeclared identifier \'foo\'' },
    { level: 'log', text: 'hello' },
  ];
  const items = parseDiagnostics({ ok: false, logs }, { activePath: 'main.cpp' });
  assert.deepEqual(items.map((d) => [d.file, d.line, d.col, d.severity]), [
    ['util.cpp', 4, 9, 'warning'],
    ['main.cpp', 12, 5, 'error'],
  ]);
});

test('duplicate diagnostics are collapsed; success yields none', () => {
  const logs = [{ level: 'error', text: 'main.cpp:1:1: error: x' }, { level: 'error', text: 'main.cpp:1:1: error: x' }];
  assert.equal(parseDiagnostics({ ok: false, logs }, { activePath: 'main.cpp' }).length, 1);
  assert.deepEqual(parseDiagnostics({ ok: true, logs: [{ level: 'log', text: 'fine' }] }, { activePath: 'a.js' }), []);
});

test('lineStartIndex jumps to 1-based line starts and clamps at the end', () => {
  const v = 'ab\ncd\nef';
  assert.equal(lineStartIndex(v, 1), 0);
  assert.equal(lineStartIndex(v, 2), 3);
  assert.equal(lineStartIndex(v, 3), 6);
  assert.equal(lineStartIndex(v, 99), v.length);
});

test('runSummary reports success, failure, timeout and stop', () => {
  assert.equal(runSummary({ ok: true, durationMs: 42 }, 'python'), 'Python · 成功 · 42 ms');
  assert.equal(runSummary({ ok: false, durationMs: 5 }, 'cpp'), 'C++ · 失败 · 5 ms');
  assert.match(runSummary({ ok: false, timedOut: true, durationMs: 30000 }, 'javascript'), /超时/);
  assert.match(runSummary({ ok: false, aborted: true }, 'javascript'), /已停止/);
});

test('project mode wiring: run uses the existing sandbox runners and commits program output back', async () => {
  const { readFileSync } = await import('node:fs');
  const { createAgent } = await import('../js/agent.js');
  const src = readFileSync(new URL('../js/project-mode.js', import.meta.url), 'utf8');
  assert.match(src, /runJavaScript\(code, fsObj/);
  assert.match(src, /runPython\(code, fsObj/);
  assert.match(src, /runCpp\(code, \{ mainPath: path/);
  assert.match(src, /agent\.sandboxCommit\(\)/);
  const store = { state: { files: {} }, notify() {}, save() {} };
  const agent = createAgent(store, {});
  const fs = agent.sandboxFS();
  fs.write('out/result.txt', 'ok');
  agent.sandboxCommit();
  assert.equal(store.state.files['out/result.txt'], 'ok');
});
