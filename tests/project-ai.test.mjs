// 第 17 条（段 3）：项目模式 AI 辅助的提示词组装与快捷动作可用性（纯逻辑）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_ACTIONS, actionById, buildAiPrompt, actionAvailability, clipText, AI_MAX_FILE_CHARS } from '../js/project-ai.js';

test('every quick action has a label, an English label and a unique id', () => {
  const ids = AI_ACTIONS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const a of AI_ACTIONS) {
    assert.ok(a.label && a.labelEn, a.id);
  }
  assert.equal(actionById('nope'), null);
});

test('explain prompt carries the file, its content and says not to modify files', () => {
  const p = buildAiPrompt({ action: 'explain', path: 'src/app.js', content: 'const a = 1;' });
  assert.match(p, /src\/app\.js/);
  assert.match(p, /const a = 1;/);
  assert.match(p, /不要修改任何文件/);
  assert.doesNotMatch(p, /直接用文件工具修改/);
});

test('editing actions tell the agent to edit the workspace file in place', () => {
  const p = buildAiPrompt({ action: 'comment', path: 'a.py', content: 'x=1' });
  assert.match(p, /直接用文件工具修改/);
});

test('fix prompt lists diagnostics; other actions do not', () => {
  const diagnostics = [{ file: 'a.js', line: 3, col: 5, message: 'Unexpected token' }];
  const fix = buildAiPrompt({ action: 'fix', path: 'a.js', content: 'x', diagnostics });
  assert.match(fix, /a\.js:3:5 Unexpected token/);
  const ex = buildAiPrompt({ action: 'explain', path: 'a.js', content: 'x', diagnostics });
  assert.doesNotMatch(ex, /当前报错/);
});

test('selection is included with its line range', () => {
  const p = buildAiPrompt({ action: 'comment', path: 'a.js', content: 'full', selection: { text: 'foo()', startLine: 4, endLine: 5 } });
  assert.match(p, /第 4–5 行/);
  assert.match(p, /foo\(\)/);
});

test('custom action uses only the user instruction', () => {
  const p = buildAiPrompt({ action: 'custom', path: 'a.js', content: 'x', instruction: '  把变量改名  ' });
  assert.match(p, /任务：把变量改名/);
  assert.doesNotMatch(buildAiPrompt({ action: 'custom', path: 'a.js', content: 'x', instruction: '' }), /任务：/);
});

test('large files are clipped head and tail with the omitted count', () => {
  const big = 'a'.repeat(AI_MAX_FILE_CHARS * 3) + 'TAIL';
  const out = clipText(big, AI_MAX_FILE_CHARS);
  assert.ok(out.length < big.length / 2);
  assert.match(out, /中间省略 \d+ 字符/);
  assert.ok(out.endsWith('TAIL'));
  assert.equal(clipText('short', 100), 'short');
});

test('action availability depends on file, diagnostics', () => {
  assert.equal(actionAvailability('explain', { hasFile: false }).ok, false);
  assert.equal(actionAvailability('explain', { hasFile: true }).ok, true);
  assert.equal(actionAvailability('fix', { hasFile: true, diagnosticsCount: 0 }).reason, 'no-diagnostics');
  assert.equal(actionAvailability('fix', { hasFile: true, diagnosticsCount: 2 }).ok, true);
  assert.equal(actionAvailability('custom').ok, true);
  assert.equal(actionAvailability('missing').reason, 'unknown');
});
