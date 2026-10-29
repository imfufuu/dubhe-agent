import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const text = (relative) => fs.readFileSync(new URL(relative, root), 'utf8');

const worker = text('js/worker-cpp.js');
const sandbox = text('js/sandbox.js');
const tools = text('js/tools.js');
const execution = text('js/execution.js');
const capabilities = text('js/capabilities.js');
const appHtml = text('app.html');

assert.match(worker, /url\.origin !== self\.location\.origin/, 'C++ Worker must reject cross-origin fetches');
assert.match(worker, /url\.pathname\.startsWith\(DIST_PATH\)/, 'C++ Worker must restrict fetches to its pinned compiler assets');
assert.match(worker, /ASSET_TYPES\[name\]/, 'C++ Worker must allow only named compiler files');
assert.doesNotMatch(worker, /godbolt\.org|Compiler Explorer|https?:\/\//i, 'C++ Worker must have no remote compiler endpoint');
assert.match(sandbox, /runInWorker\('worker-cpp\.js',[\s\S]*?workerType:\s*'module'/, 'sandbox must invoke the module Worker');
assert.match(sandbox, /allowBlobFallback:\s*false/, 'local compiler must not fall back to a blob worker');
assert.match(tools, /case 'execute_cpp':[\s\S]*?runCpp\(code,/, 'execute_cpp must route to local runCpp');
assert.match(tools, /runCppRemote\(code, runOpts\)/, 'remote mode must route through runCppRemote (default)');
assert.match(sandbox, /https:\/\/godbolt\.org/, 'remote mode endpoint is Compiler Explorer');
assert.match(execution, /execute_cpp:\s*contract\(\{ sideEffect: 'sandbox'/, 'local C++ must be classified as a local sandbox side effect');
assert.doesNotMatch(execution, /execute_cpp:\s*contract\(\{[^}]*external:\s*true/, 'local C++ must not be recorded as an external action');
assert.match(capabilities, /execute_cpp:\s*R\('codeSandbox', 'exec'/, 'local C++ is an execution capability, not a remote capability');
assert.match(appHtml, /connect-src 'self'/, 'same-origin compiler assets must be permitted by CSP');
assert.match(appHtml, /connect-src[^;]*https:\/\/godbolt\.org/, 'CSP must allow the remote C++ mode endpoint');

const realFetch = globalThis.fetch;
const fetchedAssets = new Set();
const distDir = path.resolve(fileURLToPath(new URL('../assets/vendor/cpp/browsercc/runtime/', import.meta.url)));
globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.protocol, 'file:', 'test runtime may load only its vendored local assets');
  const assetName = path.basename(url.pathname);
  assert.ok(['clang.wasm', 'lld.wasm', 'sysroot.tar'].includes(assetName), `unexpected C++ asset: ${assetName}`);
  const resolved = path.resolve(fileURLToPath(url));
  assert.ok(resolved.startsWith(distDir + path.sep), 'compiler assets must remain under the vendored distribution');
  fetchedAssets.add(assetName);
  const compressedPath = `${resolved}.gz`;
  const bytes = gunzipSync(fs.readFileSync(compressedPath));
  return new Response(bytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
};

try {
  const { compileAndRunCpp } = await import('../js/local-cpp-runtime.js');
  const phases = [];
  const result = await compileAndRunCpp({
    mainPath: 'project/src/main.c++',
    code: [
      '#include <iostream>',
      '#include "../include/value.hpp"',
      'int main(int argc, char** argv) {',
      '  int value = 0;',
      '  std::cin >> value;',
      '  std::cout << (argc > 1 ? argv[1] : "missing") << ":" << doubleValue(value) << "\\n";',
      '  return 7;',
      '}',
    ].join('\n'),
    files: [
      { filename: 'project/include/value.hpp', contents: '#pragma once\nint doubleValue(int value);\n', compile: false },
      { filename: 'project/src/value.cpp', contents: '#include "../include/value.hpp"\nint doubleValue(int value) { return value * 2; }\n' },
    ],
    stdin: '21\n',
    args: ['local'],
  }, { onPhase: (phase) => phases.push(phase) });

  assert.equal(result.ok, false, 'a non-zero program exit is reported as a failed process');
  assert.equal(result.exitCode, 7, 'WASI exit status must be preserved');
  assert.ok(result.logs.some((entry) => entry.level === 'log' && entry.text.includes('local:42')), 'stdout must include argv + stdin result');
  assert.deepEqual(phases, ['loading-assets', 'compiling', 'program-start']);
  assert.deepEqual([...fetchedAssets].sort(), ['clang.wasm', 'lld.wasm', 'sysroot.tar']);
  assert.doesNotMatch(JSON.stringify(result), /godbolt\.org|Compiler Explorer/i);
  console.log('local C++ regression: isolation checks + multi-file/stdin/argv/exit-code smoke passed');
} finally {
  globalThis.fetch = realFetch;
}
