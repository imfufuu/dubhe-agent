// 提示词限制条款：「作用域 + 反例」「禁止外推」「边界存疑先实测」回归（2026-11-09）。
// 其中实测部分本身就是一个最小探针：写 internal/ 文件 → 验证 → 清理。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { coreSystemPrompt } from '../js/prompt-core.js';
import { createFS, sanitizeWorkerFiles } from '../js/sandbox.js';
import { executeTool, TOOL_DEFS } from '../js/tools.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('实测：write_file 可写 internal/，只有 Worker 回写通道拦截 internal/ 与 .git/', async () => {
  const fsx = createFS();
  const probe = 'internal/scope-probe.txt';
  const out = await executeTool('write_file', { path: probe, content: 'probe-ok' }, { fs: fsx, onUi: () => {} });
  assert.match(String(out), /已写入 internal\/scope-probe\.txt/);
  assert.equal(fsx.read(probe), 'probe-ok', 'write_file 写入 internal/ 必须真实生效');
  fsx.remove(probe);
  assert.equal(fsx.has(probe), false, '探针文件必须清理');

  const before = { 'internal/keep.txt': 'original', 'files/a.txt': 'a' };
  const after = { 'internal/keep.txt': 'HACKED', 'internal/new.txt': 'x', '.git/config': 'y', 'files/a.txt': 'b' };
  const r = sanitizeWorkerFiles(before, after);
  assert.equal(r.files['internal/keep.txt'], 'original');
  assert.equal(r.files['files/a.txt'], 'b');
  assert.equal('internal/new.txt' in r.files, false);
  assert.equal('.git/config' in r.files, false);
  assert.deepEqual(r.rejected.map((x) => x.reason), ['protected', 'protected', 'protected']);
});

test('中文核心提示词：作用域限定 + write_file 反例 + 两条元规则', () => {
  const zh = coreSystemPrompt(new Date(), { language: 'zh' });
  assert.match(zh, /作用域限定：execute_javascript 的 files 字典与 execute_python 的 FILES 字典/);
  assert.match(zh, /此限制仅作用于上述沙箱写入通道/);
  assert.match(zh, /反例：write_file 工具不受此限制，可写 internal\//);
  assert.match(zh, /能力限制按字面作用域理解，禁止外推/);
  assert.match(zh, /未写出的对象\/通道默认允许/);
  assert.match(zh, /必须已经实测确认过该对象/);
  assert.match(zh, /写探针文件 → 验证 → 清理/);
  assert.match(zh, /禁止用全局性词汇描述未经实测验证的限制范围/);
  assert.doesNotMatch(zh, /Worker不能写internal\/和\.git\//, '旧的含糊否定句必须移除');
});

test('英文核心提示词：同样的作用域、反例、禁止外推与实测规则', () => {
  const en = coreSystemPrompt(new Date(), { language: 'en' });
  assert.match(en, /Scope: the files dictionary in execute_javascript and the FILES dictionary in execute_python/);
  assert.match(en, /applies ONLY to those sandbox write-back channels/);
  assert.match(en, /Counter-example: the write_file tool is NOT subject to it and can write internal\//);
  assert.match(en, /Read capability restrictions literally, with no extrapolation/);
  assert.match(en, /never apply one restriction to tools or paths it does not explicitly list/);
  assert.match(en, /run a minimal probe first/);
  assert.match(en, /Never describe an unverified restriction scope with global wording/);
  assert.doesNotMatch(en, /protected from worker writes/);
});

test('工具描述、参考提示词、设置页文案、实现注释与知识库同步（无旧全局句）', () => {
  const tools = read('js/tools.js');
  const jsDesc = TOOL_DEFS.find((t) => t.name === 'execute_javascript').description;
  const pyDesc = TOOL_DEFS.find((t) => t.name === 'execute_python').description;
  assert.match(pyDesc, /本沙箱回写通道（FILES 字典）不能写 internal\/ 与 \.git\//);
  assert.match(pyDesc, /write_file 工具不受此限制/);
  assert.match(jsDesc, /本沙箱回写通道（files 字典）不能写 internal\/ 与 \.git\//);
  assert.doesNotMatch(tools, /internal\/ 与 \.git\/ 受保护/);
  const config = read('js/config.js');
  assert.match(config, /此限制仅作用于 files\/FILES 回写通道/);
  assert.match(config, /能力限制按字面作用域理解，禁止外推/);
  assert.match(config, /写探针文件 → 验证 → 清理/);
  const strings = read('js/ui-strings.js');
  assert.match(strings, /沙箱 files\/FILES 回写通道不能写 internal\/ 与 \.git\//);
  assert.doesNotMatch(strings, /internal\/ 受保护/);
  assert.match(read('js/sandbox.js'), /仅限本函数处理的 Worker 回写通道/);
  assert.match(read('assets/knowledge/index.json'), /此限制仅作用于 files\/FILES 回写通道/);
});
