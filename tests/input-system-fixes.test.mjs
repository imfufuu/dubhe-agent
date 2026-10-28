// 输入区布局 / 浮层定位 / 本地模型标签 / 用户消息链接 / C++ 工具链进度 / /system 命令补全 回归
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getSystemCommandSuggestions, SYSTEM_COMMAND_SPECS } from '../js/system-command-complete.js';
import { installComposerOffset } from '../js/ui-composer-offset.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../css/styles.css');
const ui = read('../js/ui.js');
const picker = read('../js/ui-model-picker.js');
const tools = read('../js/tools.js');
const sandbox = read('../js/sandbox.js');
const workerCpp = read('../js/worker-cpp.js');
const toolflow = read('../js/ui-toolflow.js');

test('single-line composer text is vertically centred; only multiline text is top-aligned', () => {
  assert.match(css, /\n#composer-input \{[^}]*align-self: center;/);
  assert.doesNotMatch(css, /\n#composer-input \{[^}]*align-self: start;/);
  assert.match(css, /\.composer\.is-multiline #composer-input \{ align-self: start; \}/);
});

test('floating jump/undo buttons follow the live composer height instead of fixed bottoms', () => {
  assert.match(css, /#jump-bottom \{\s*position: absolute; left: 50%; bottom: calc\(var\(--composer-wrap-h, 112px\) \+ 14px\)/);
  assert.match(css, /#undo-pill \{\s*position: absolute; left: 50%; bottom: calc\(var\(--composer-wrap-h, 112px\) \+ 62px\)/);
  assert.match(css, /#jump-bottom \{ bottom: calc\(var\(--composer-wrap-h, 112px\) \+ 12px\)/);
  assert.match(ui, /installComposerOffset\(\{ main: \$\('\.main'\), wrap: \$\('\.composer-wrap'\) \}\)/);
});

test('installComposerOffset writes the wrap height into --composer-wrap-h and tracks resizes', () => {
  const style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
  const main = { style };
  const wrap = { offsetHeight: 96 };
  let observed = null;
  globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; observed = this; } observe() {} disconnect() { this.disconnected = true; } };
  const listeners = {};
  globalThis.window = { addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {} };
  const dispose = installComposerOffset({ main, wrap });
  assert.equal(style.props['--composer-wrap-h'], '96px');
  wrap.offsetHeight = 150.2;
  observed.cb();
  assert.equal(style.props['--composer-wrap-h'], '151px');
  listeners.resize();
  assert.equal(style.props['--composer-wrap-h'], '151px');
  dispose();
  assert.equal(observed.disconnected, true);
  delete globalThis.ResizeObserver; delete globalThis.window;
});

test('offline/local model shows LOCAL with the same icon as the menu group, not the 本 provider badge', () => {
  assert.match(picker, /icon = LOCAL_PROVIDER_ICON;/);
  assert.match(picker, /prov = 'LOCAL';/);
  assert.doesNotMatch(picker, /prov = isNetworkOffline\(\) \? localeText\('离线 · 本地'/);
  assert.match(css, /\.model-btn-icon \.p-icon\.local-provider-icon \{/);
});

test('user bubble links keep the bubble text colour in every link state', () => {
  assert.match(css, /\.msg-user \.bubble\.md-body a \{ color: var\(--chat-user-text\)/);
  assert.match(css, /\.msg-user \.bubble\.md-body a:is\(:link, :visited, :focus-visible, :active\) \{[^}]*-webkit-text-fill-color: var\(--chat-user-text\)/);
});

test('system command candidates: commands, aliases, arguments and non-commands', () => {
  const names = (v, opts) => (getSystemCommandSuggestions(v, opts)?.items || []).map((i) => i.insert);
  assert.equal(getSystemCommandSuggestions('hello'), null, 'plain text shows no menu');
  assert.equal(getSystemCommandSuggestions('  ／de')?.mode, 'command', 'full-width slash is accepted');
  assert.ok(names('/').includes('/help'));
  assert.equal(names('/').length, SYSTEM_COMMAND_SPECS.length);
  assert.deepEqual(names('/deb'), ['/debug ']);
  assert.deepEqual(names('/debug '), ['/debug on', '/debug off']);
  assert.deepEqual(names('/debug o'), ['/debug on', '/debug off']);
  assert.deepEqual(names('/theme d'), ['/theme dark']);
  assert.deepEqual(names('/guard strict'), ['/guard strict', '/guard strict-l2']);
  assert.deepEqual(names('/cache c'), ['/cache clear']);
  assert.deepEqual(names('/model cl', { models: ['gpt-5', 'claude-sonnet-5'] }), ['/model claude-sonnet-5']);
  assert.ok(names('/p2 fault ').includes('/p2 fault tool-timeout'));
  assert.deepEqual(names('/p2 fault tool-t'), ['/p2 fault tool-timeout']);
  assert.deepEqual(names('/env'), ['/env']);
  assert.deepEqual(names('/environment'), []);
  assert.deepEqual(names('/xyz'), []);
});

test('system command completion controller is wired into the composer keydown/input/send paths', () => {
  const ctrl = read('../js/ui-system-complete.js');
  assert.match(ctrl, /ArrowDown/); assert.match(ctrl, /ArrowUp/); assert.match(ctrl, /'Tab'/); assert.match(ctrl, /'Escape'/);
  assert.match(ctrl, /if \(e\.key === 'Enter' && !e\.shiftKey\)/);
  assert.match(ui, /if \(sysComplete\.handleKeydown\(e\)\) return;/);
  assert.match(ui, /composer\.addEventListener\('input', \(\) => sysComplete\.refresh\(\)\)/);
  assert.match(ui, /composer\.value = ''; autoGrow\(\); sysComplete\.close\(\);/);
  assert.match(css, /\.sys-cmd-menu \{/);
});

test('C++ toolchain download reports byte progress through worker → sandbox → tool chip', () => {
  assert.match(workerCpp, /self\.postMessage\(\{ __progress: \{ phase: 'loading-assets', loaded: sumLoaded, total: sumTotal \} \}\)/);
  assert.match(workerCpp, /countBytes\(response\.body/);
  assert.match(sandbox, /if \(data\?\.__progress\) \{ try \{ onProgress\?\.\(data\.__progress\)/);
  assert.match(sandbox, /onProgress: opts\.onProgress,/);
  assert.match(tools, /onProgress: \(p\) => \{/);
  assert.match(tools, /progress: fraction,/);
  assert.match(toolflow, /progress: t\.status === 'running' \? \(t\.progress \?\? null\) : null,/);
  assert.match(ui, /class="chip-progress" role="progressbar"/);
  assert.match(css, /\.chip-state \.chip-progress \{/);
});
