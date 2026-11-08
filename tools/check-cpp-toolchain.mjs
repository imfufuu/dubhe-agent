#!/usr/bin/env node
// 本地 C++ 工具链完整性检查（2026-11-08）。
// 三层：① 主机原生编译器/构建工具 ② 真实编译并运行一个 C++17 程序 ③ 浏览器内 WASM C++ 运行时资源。
// 应用里的 execute_cpp 默认走 godbolt.org 远程模式；「本地」模式完全依赖第 ③ 层的随仓库分发资源，
// 不要求用户在自己电脑上安装 g++/cmake。因此两层结论分开给，不把「缺 cmake」误报成「应用不可用」。
//   node tools/check-cpp-toolchain.mjs           # 检查并写 CPP_TOOLCHAIN_REPORT.md
//   node tools/check-cpp-toolchain.mjs --json    # 只输出 JSON（CI / 脚本消费）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLS = ['g++', 'gcc', 'clang++', 'clang', 'cmake', 'make', 'ninja', 'gdb', 'pkg-config', 'ar'];
const WASM_FILES = [
  'assets/vendor/cpp/browsercc/runtime/clang.js',
  'assets/vendor/cpp/browsercc/runtime/clang.wasm.gz',
  'assets/vendor/cpp/browsercc/runtime/lld.js',
  'assets/vendor/cpp/browsercc/runtime/lld.wasm.gz',
  'assets/vendor/cpp/browsercc/runtime/sysroot.tar.gz',
  'assets/vendor/cpp/browsercc/runtime/index.js',
  'assets/vendor/cpp/browser-wasi-shim/runtime/index.js',
  'assets/vendor/cpp/browser-wasi-shim/runtime/wasi.js',
  'assets/vendor/cpp/browser-wasi-shim/runtime/fd.js',
  'assets/vendor/cpp/browser-wasi-shim/runtime/fs_mem.js',
  'js/local-cpp-runtime.js',
  'js/worker-cpp.js',
];
const LICENSE_FILES = [
  'assets/vendor/cpp/LICENSE-WASI-SDK.txt', 'assets/vendor/cpp/LICENSE-LLVM.TXT',
  'assets/vendor/cpp/LICENSE-EMSCRIPTEN.txt', 'assets/vendor/cpp/browsercc/LICENSE',
  'assets/vendor/cpp/browser-wasi-shim/LICENSE-MIT',
];

function which(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || '').split(/\r?\n/)[0].trim() : '';
}
function version(name) {
  const r = spawnSync(name, ['--version'], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout || r.stderr || '').split(/\r?\n/)[0].trim().slice(0, 120) : '';
}

const native = Object.fromEntries(TOOLS.map((name) => {
  const bin = which(name);
  return [name, { available: !!bin, path: bin, version: bin ? version(name) : '' }];
}));

// 真实编译：覆盖 C++17 <filesystem>/<thread>/<regex>/模板，链接标准库并运行。
const SOURCE = `#include <algorithm>
#include <filesystem>
#include <iostream>
#include <regex>
#include <string>
#include <thread>
#include <vector>
int main() {
  std::vector<int> v{3, 1, 2};
  std::sort(v.begin(), v.end());
  std::string s = "dubhe-cpp-17";
  std::regex re("cpp-([0-9]+)");
  std::smatch m;
  if (!std::regex_search(s, m, re)) return 2;
  int seen = 0;
  std::thread t([&]() { seen = std::stoi(m[1]); });
  t.join();
  std::cout << "cpp17-ok:" << seen << ":" << v.front() << ":" << std::filesystem::path("a/b").filename().string();
  return 0;
}
`;
let compileRun = { ok: false, compiler: '', output: '', error: '' };
for (const cc of ['g++', 'clang++']) {
  if (!native[cc].available) continue;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dubhe-cpp-'));
  const src = path.join(tmp, 'probe.cpp'), bin = path.join(tmp, 'probe');
  fs.writeFileSync(src, SOURCE);
  const built = spawnSync(cc, ['-std=c++17', '-O1', '-pthread', src, '-o', bin], { encoding: 'utf8' });
  if (built.status !== 0) { compileRun.error = `${cc} 编译失败：${String(built.stderr || '').slice(0, 300)}`; fs.rmSync(tmp, { recursive: true, force: true }); continue; }
  const run = spawnSync(bin, [], { encoding: 'utf8' });
  compileRun = {
    ok: run.status === 0 && /^cpp17-ok:17:1:b/.test(String(run.stdout || '').trim()),
    compiler: cc, output: String(run.stdout || '').trim(), error: String(run.stderr || '').slice(0, 200),
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  break;
}

const assets = WASM_FILES.map((rel) => {
  const p = path.join(ROOT, rel);
  const exists = fs.existsSync(p);
  return { file: rel, exists, bytes: exists ? fs.statSync(p).size : 0 };
});
const licenses = LICENSE_FILES.map((rel) => ({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }));
const tests = ['tests/local-cpp-policy.test.mjs', 'tests/local-cpp.test.mjs', 'tests/cpp-remote.test.mjs']
  .map((rel) => ({ file: rel, exists: fs.existsSync(path.join(ROOT, rel)) }));

const assetsOk = assets.every((a) => a.exists && a.bytes > 0);
const nativeCore = ['g++', 'clang++'].some((c) => native[c].available);
const missingBuildTools = TOOLS.filter((t) => !['g++', 'clang++', 'gcc', 'clang'].includes(t) && !native[t].available);
const report = {
  checkedAt: new Date().toISOString(),
  platform: `${process.platform} ${process.arch} ${os.release()}`,
  native, compileRun, assets, licenses, tests,
  conclusion: {
    nativeCompilerUsable: nativeCore && compileRun.ok,
    nativeToolchainComplete: TOOLS.every((t) => native[t].available),
    missingBuildTools,
    browserWasmRuntimeComplete: assetsOk && licenses.every((l) => l.exists) && tests.every((t) => t.exists),
    appCppUsable: assetsOk || (nativeCore && compileRun.ok),
  },
};

if (!process.argv.includes('--json')) {
  const table = (rows, cols) => [
    `| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
  const md = `# 本地 C++ 工具链检查报告

生成时间：${report.checkedAt} · 主机：${report.platform} · 命令：\`node tools/check-cpp-toolchain.mjs\`

## 结论

- **应用内 C++ 可用：${report.conclusion.appCppUsable ? '是' : '否'}**。浏览器「本地」模式使用随仓库分发的 Clang/LLD WASM（\`@browsercc\` + WASI shim），不要求本机安装编译器；默认「远程」模式经 godbolt.org 编译执行。
- 本机原生编译器可编译并运行 C++17：**${report.conclusion.nativeCompilerUsable ? '是' : '否'}**（${compileRun.compiler || '未找到'}，输出 \`${compileRun.output || compileRun.error}\`）。
- 本机原生工具链「完整」：**${report.conclusion.nativeToolchainComplete ? '是' : '否'}**；缺：${missingBuildTools.length ? missingBuildTools.join('、') : '无'}。缺失这些不影响浏览器内 WASM 编译，只影响在本机直接构建原生 C++ 项目。
- 浏览器 WASM 运行时资源与许可证、回归测试齐备：**${report.conclusion.browserWasmRuntimeComplete ? '是' : '否'}**。

## ① 主机工具

${table(TOOLS.map((t) => [t, native[t].available ? '✅' : '—', native[t].version || '未安装', native[t].path || '']), ['工具', '可用', '版本', '路径'])}

C++17 真实编译/运行探针：\`${compileRun.ok ? '通过' : '未通过'}\`，输出 \`${compileRun.output || compileRun.error}\`。

## ② 浏览器内 WASM 运行时资源

${table(assets.map((a) => [a.file.replace('assets/vendor/cpp/', ''), a.exists ? '✅' : '❌', a.bytes ? `${(a.bytes / 1024).toFixed(0)} KiB` : '—']), ['文件', '存在', '大小'])}

许可证：${licenses.map((l) => `${l.exists ? '✅' : '❌'} ${l.file.split('/').pop()}`).join(' · ')}

回归测试：${tests.map((t) => `${t.exists ? '✅' : '❌'} ${t.file}`).join(' · ')}

## 边界

远程模式会把源码发送到第三方 Compiler Explorer；本地模式的源码、附带文件与 stdin 只在浏览器 Worker 内处理。此报告只检查本机环境与应用自带资源，不代表 WASM 编译器在每种浏览器/设备上都能成功初始化（需浏览器运行时实测）。
`;
  fs.writeFileSync(path.join(ROOT, 'CPP_TOOLCHAIN_REPORT.md'), md);
  console.log(md);
} else {
  console.log(JSON.stringify(report, null, 2));
}
// Exit code reflects the app-level capability, not the optional native build tools.
process.exitCode = report.conclusion.appCppUsable ? 0 : 1;
