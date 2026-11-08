// 本地 C++ 工具链检查脚本与报告的回归：三层检查口径、JSON 可消费、报告入库。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const script = new URL('../tools/check-cpp-toolchain.mjs', import.meta.url);
const report = new URL('../CPP_TOOLCHAIN_REPORT.md', import.meta.url);

test('检查脚本可运行并输出结构化 JSON', () => {
  const r = spawnSync(process.execPath, [script.pathname, '--json'], { encoding: 'utf8', cwd: ROOT.pathname });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const data = JSON.parse(r.stdout);
  assert.ok(data.checkedAt && data.platform);
  assert.ok(data.native && data.compileRun && data.assets && data.licenses && data.tests);
  assert.equal(data.conclusion.browserWasmRuntimeComplete, true, '随仓库分发的 Clang/LLD WASM 与许可证、测试必须齐备');
  assert.equal(data.conclusion.appCppUsable, true, '应用内 C++ 应可用（远程模式或浏览器本地模式）');
  assert.ok(Array.isArray(data.conclusion.missingBuildTools));
  assert.ok(data.assets.some((a) => a.file.endsWith('clang.wasm.gz') && a.bytes > 1000));
});

test('报告入库且明确区分「本机原生工具链」与「应用内 C++ 可用性」', () => {
  assert.ok(fs.existsSync(report), '请先运行 node tools/check-cpp-toolchain.mjs');
  const md = fs.readFileSync(report, 'utf8');
  assert.match(md, /本地 C\+\+ 工具链检查报告/);
  assert.match(md, /应用内 C\+\+ 可用/);
  assert.match(md, /浏览器内 WASM 运行时资源/);
  assert.match(md, /C\+\+17 真实编译\/运行探针/);
});

test('脚本包含真实编译探针，而不是只看 which', () => {
  const src = fs.readFileSync(script, 'utf8');
  for (const needle of ['-std=c++17', '<filesystem>', '<thread>', '<regex>', 'spawnSync']) assert.ok(src.includes(needle), needle);
});
