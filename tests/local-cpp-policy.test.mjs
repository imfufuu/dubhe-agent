import assert from 'node:assert/strict';
import { createStore } from '../js/state.js';
import { STORAGE_KEY } from '../js/config.js';
import { TOOL_DEFS, executeTool, toolsFor } from '../js/tools.js';
import { createFS } from '../js/sandbox.js';
import { subagentTools } from '../js/agent.js';
import { CAPABILITY_REGISTRY } from '../js/capabilities.js';
import * as execution from '../js/execution.js';
import * as executionContext from '../js/executionContext.js';
import * as offlinePolicy from '../js/offline-policy.js';
import { coreSystemPrompt } from '../js/prompt-core.js';
import { UI_STRINGS } from '../js/ui-strings.js';

const cpp = TOOL_DEFS.find((tool) => tool.name === 'execute_cpp');
assert.ok(cpp);
assert.ok(toolsFor(true).some((tool) => tool.name === 'execute_cpp'));
assert.ok(!toolsFor(true, { localCpp: false }).some((tool) => tool.name === 'execute_cpp'));
assert.ok(toolsFor(true, { localCpp: false }).some((tool) => tool.name === 'execute_python'));
assert.ok(!toolsFor(false).some((tool) => tool.name === 'execute_cpp'));
assert.match(cpp.description, /本地浏览器 Worker/);
assert.match(cpp.description, /Clang\/LLD/);
assert.doesNotMatch(cpp.description, /godbolt\.org|Compiler Explorer|remote compiler/i);
assert.equal(CAPABILITY_REGISTRY.execute_cpp.kind, 'exec', 'local C++ is registered as an execution, not remote/network, capability');
assert.equal(execution.TOOL_CONTRACTS.execute_cpp.sideEffect, 'sandbox');
assert.notEqual(execution.TOOL_CONTRACTS.execute_cpp.external, true);
const promptZh = coreSystemPrompt(new Date(0), {});
const promptEn = coreSystemPrompt(new Date(0), { language: 'en' });
assert.match(promptZh, /execute_cpp在同源Clang\/LLD WASM Worker内本地编译执行/);
assert.match(promptEn, /execute_cpp compiles\/runs locally/);
assert.match(promptZh, /所选对话模型仍按其网关政策处理对话与工具上下文/);
assert.match(promptEn, /selected chat model still processes conversation\/tool context under its own gateway policy/);
const cppSettingEn = UI_STRINGS['本机编译，源码不发远程编译器；聊天仍走所选网关；首用下载约30MB工具链'];
assert.match(cppSettingEn, /source stays off the remote compiler/);
assert.match(cppSettingEn, /chat still uses your selected gateway/);
assert.doesNotMatch(promptZh + promptEn, /godbolt\.org|Compiler Explorer/);

const disabled = execution.buildCapabilityConstraints({ sandboxEnabled: true, localCppEnabled: false });
assert.equal(disabled.sandbox.localCpp, false);
assert.match(execution.describeCapabilityConstraints(disabled), /本地C\+\+off/);
const filtered = executionContext.deriveToolWhitelist(
  executionContext.createTurnExecutionContext({ turnId: 'cpp-off', sessionId: 'local', capability: disabled }),
  TOOL_DEFS,
);
assert.ok(!filtered.allowed.some((tool) => tool.name === 'execute_cpp'));
assert.ok(filtered.dropped.some((item) => item.name === 'execute_cpp' && item.reason === 'local-cpp-off'));
assert.equal(executionContext.DROP_REASON_LABEL['local-cpp-off'], '本地 C++ 已关');
assert.equal(offlinePolicy.isOfflineToolAllowed('execute_cpp'), true);
assert.deepEqual(
  subagentTools(true, { tools: ['execute_cpp', 'execute_python', 'read_file'] }, { localCpp: false }).map((tool) => tool.name),
  ['skill_library', 'knowledge_search', 'execute_python', 'read_file'],
);

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const restoreStorage = () => {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
  else delete globalThis.localStorage;
};
const migratedSettings = (settings) => {
  const values = new Map([[`${STORAGE_KEY}-v2`, JSON.stringify({ settings })]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  try { return createStore().state.settings; }
  finally { restoreStorage(); }
};
const oldDisabled = migratedSettings({ remoteCppEnabled: false });
assert.equal(oldDisabled.localCppEnabled, false);
assert.equal(Object.hasOwn(oldDisabled, 'remoteCppEnabled'), false);
assert.equal(migratedSettings({ remoteCppEnabled: true }).localCppEnabled, true);
assert.equal(migratedSettings({}).localCppEnabled, true);
assert.equal(migratedSettings({ localCppEnabled: false, remoteCppEnabled: true }).localCppEnabled, false);
const oldOverride = migratedSettings({ capabilityConstraints: { sandbox: { remoteCpp: false, network: false } } });
assert.equal(oldOverride.capabilityConstraints.sandbox.localCpp, false);
assert.equal(oldOverride.capabilityConstraints.sandbox.remoteCpp, undefined);

const previousWorker = globalThis.Worker;
const workers = [];
class FakeCppWorker {
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.terminated = false;
    workers.push(this);
    queueMicrotask(() => this.onmessage?.({ data: { __dubheReady: 'cpp-runtime-1' } }));
  }
  postMessage(payload) {
    this.payload = payload;
    queueMicrotask(() => {
      for (const phase of ['loading-assets', 'compiling', 'program-start']) this.onmessage?.({ data: { __phase: phase } });
      this.onmessage?.({ data: { ok: true, logs: [{ level: 'log', text: 'local-worker-ok' }], exitCode: 0 } });
    });
  }
  terminate() { this.terminated = true; }
}
globalThis.Worker = FakeCppWorker;
const originalFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error('Unexpected network access in local C++ tool test'); };
try {
  const fs = createFS({
    'src/main.cpp': '#include "util.h"\nint main(){ return 0; }\n',
    'src/util.h': 'int n = 42;\n',
    'src/in.txt': 'hello-stdin\n',
  });
  const result = await executeTool('execute_cpp', {
    path: 'src/main.cpp', stdin_path: 'src/in.txt', args: ['--quiet'],
  }, { fs, sandboxEnabled: true, localCpp: true, onUi: () => {} });
  assert.match(result, /local-worker-ok/);
  assert.equal(fetchCalls, 0, 'the tool handler must not send source or inputs over fetch');
  assert.equal(workers.length, 1);
  assert.match(workers[0].url, /worker-cpp\.js/);
  assert.equal(workers[0].options.type, 'module');
  assert.equal(workers[0].payload.mainPath, 'src/main.cpp');
  assert.match(workers[0].payload.code, /#include "util.h"/);
  assert.ok(workers[0].payload.files.some((file) => file.filename === 'src/util.h' && file.contents.includes('int n = 42')));
  assert.equal(workers[0].payload.stdin, 'hello-stdin\n');
  assert.deepEqual(workers[0].payload.args, ['--quiet']);
  assert.equal(workers[0].terminated, true);

  const refused = await executeTool('execute_cpp', { code: 'int main(){}' }, {
    fs, sandboxEnabled: true, localCpp: false, onUi: () => {},
  });
  assert.match(refused, /本地 C\+\+/);
  assert.equal(workers.length, 1, 'disabled C++ must be rejected before starting a worker');
} finally {
  globalThis.fetch = originalFetch;
  if (previousWorker === undefined) delete globalThis.Worker;
  else globalThis.Worker = previousWorker;
}

const workerSource = await (await import('node:fs/promises')).readFile(new URL('../js/worker-cpp.js', import.meta.url), 'utf8');
assert.match(workerSource, /url\.origin !== self\.location\.origin/);
assert.match(workerSource, /ASSET_TYPES\[name\]/);
assert.doesNotMatch(workerSource, /godbolt\.org|Compiler Explorer|https?:\/\//i);
console.log('local C++ policy/integration: settings migration, offline gate, capability filtering, worker payload and no-fetch checks passed');
