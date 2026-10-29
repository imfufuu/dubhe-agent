// C++ 远程模式（Compiler Explorer）回归：默认远程、本地模式不发请求、payload 结构正确。
import assert from 'node:assert/strict';
import { executeTool } from '../js/tools.js';
import { createFS, runCppRemote } from '../js/sandbox.js';

const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (String(url).includes('/api/compilers/')) {
    return new Response(JSON.stringify([{ id: 'g120', semver: '12.0.0' }, { id: 'g142', semver: '14.2.0' }, { id: 'g550', semver: '5.5.0' }]), { status: 200 });
  }
  return new Response(JSON.stringify({ code: 0, stdout: [{ text: 'remote-ok' }], stderr: [] }), { status: 200 });
};

try {
  // 1. 直接调用远程执行：payload 与端点
  const out = await runCppRemote('int main(){}', { args: ['--x'], stdin: 'in', timeoutMs: 5000 });
  assert.equal(out.ok, true);
  assert.deepEqual(out.logs, [{ level: 'log', text: 'remote-ok' }]);
  const compile = calls.find((c) => /\/compile$/.test(c.url));
  assert.ok(compile, '必须请求 godbolt.org 编译端点');
  assert.match(compile.url, /^https:\/\/godbolt\.org\/api\/compiler\/g142\/compile$/, '按 semver 选择最新 GCC');
  const body = JSON.parse(compile.init.body);
  assert.equal(body.options.compilerOptions.executorRequest, true);
  assert.equal(body.options.userArguments, '-O2 -std=c++20');
  assert.deepEqual(body.options.executeParameters, { args: ['--x'], stdin: 'in' });

  // 2. 默认（未指定 cppMode）走远程
  calls.length = 0;
  const fs = createFS({});
  const remote = await executeTool('execute_cpp', { code: 'int main(){ return 0; }' }, { fs, sandboxEnabled: true, localCpp: true, onUi: () => {} });
  assert.match(remote, /remote-ok/);
  assert.ok(calls.some((c) => c.url.includes('godbolt.org')), '默认模式必须发起远程请求');

  // 3. 本地模式：不得发出任何网络请求
  calls.length = 0;
  await executeTool('execute_cpp', { code: 'int main(){ return 0; }' }, { fs, sandboxEnabled: true, localCpp: true, cppMode: 'local', onUi: () => {} }).catch(() => {});
  assert.equal(calls.filter((c) => c.url.includes('godbolt.org')).length, 0, '本地模式不得请求 godbolt.org');

  // 4. 远程失败时给出可读错误
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const failed = await runCppRemote('int main(){}', { timeoutMs: 5000 });
  assert.equal(failed.ok, false);
  assert.match(failed.error.message, /godbolt\.org 不可达/);
  console.log('C++ remote mode regression passed');
} finally {
  globalThis.fetch = realFetch;
}
