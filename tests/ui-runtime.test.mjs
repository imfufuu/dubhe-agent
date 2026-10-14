import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { pythonPackagesForRun } from '../js/sandbox.js';
import { animateMessageSend } from '../js/ui-send-animation.js';
import { demoCharacterDelay } from '../js/home-demo.js';
import { syncEditingFold } from '../js/ui-editpreview.js';

const workerSource = fs.readFileSync(new URL('../js/worker-py.js', import.meta.url), 'utf8');
function packageLoader(roots = []) {
  const loads = [], wheels = [], context = { post() {}, pushLog(logs, level, text) { logs.push({ level, text }); } };
  vm.createContext(context);
  vm.runInContext('const installed = new Set();\n' + workerSource.slice(workerSource.indexOf('const IMPORT_ALIAS'), workerSource.indexOf("self.addEventListener('message'")) + '\nglobalThis.scan = PY_IMPORT_SCAN;', context);
  let destroyed = 0;
  const py = {
    toPy: () => ({ destroy() { destroyed++; } }), runPython: () => JSON.stringify(roots), loadedPackages: {},
    loadPackage: async (name) => { loads.push(name); if (name === 'only-on-pypi') throw new Error('unknown'); py.loadedPackages[name] = true; },
    pyimport: () => ({ install: async (name) => wheels.push(name), destroy() { destroyed++; } }),
  };
  return { context, py, loads, wheels, destroyed: () => destroyed };
}

test('Python payload only includes this call, never package history', () => {
  assert.deepEqual(pythonPackagesForRun(), []);
  assert.deepEqual(pythonPackagesForRun([' numpy ', 'numpy', '', null]), ['numpy']);
  const src = fs.readFileSync(new URL('../js/sandbox.js', import.meta.url), 'utf8');
  assert.equal(src.includes('loadPyPkgs'), false); assert.equal(src.includes('savePyPkgs'), false);
  assert.match(src, /new Worker\(versionedURL\('worker-py.js'\)\)/);
});
test('stdlib-only execution loads no package and no micropip', async () => {
  const h = packageLoader(); await h.context.ensurePackages(h.py, [], 'print(1)', []);
  assert.deepEqual(h.loads, []); assert.equal(h.destroyed(), 1);
});
test('bundled package loads once and does not bootstrap micropip', async () => {
  const h = packageLoader(['numpy']);
  await h.context.ensurePackages(h.py, [], 'import numpy', []);
  await h.context.ensurePackages(h.py, ['numpy'], 'import numpy', []);
  assert.deepEqual(h.loads, ['numpy']); assert.deepEqual(h.wheels, []);
});
test('micropip is lazy, requested only for a PyPI fallback, then destroyed', async () => {
  const h = packageLoader(); await h.context.ensurePackages(h.py, ['only-on-pypi'], '', []);
  assert.deepEqual(h.loads, ['only-on-pypi', 'micropip']); assert.deepEqual(h.wheels, ['only-on-pypi']);
  assert.equal(h.destroyed(), 2);
  await h.context.ensurePackages(h.py, ['only-on-pypi'], '', []);
  assert.equal(h.wheels.length, 1);
});
test('real Python AST skips strings/comments/stdlib and detects multiple/dotted imports', () => {
  const { context } = packageLoader();
  const source = '# import unwanted_a\ntext = """\nimport unwanted_b\n"""\nimport json, zoneinfo\nimport dubhe_missing_a, dubhe_missing_b.tools\nfrom dubhe_missing_c.inner import x\n';
  const program = 'source = ' + JSON.stringify(source) + '\n' + context.scan.replace('json.dumps(needed(source))', 'print(json.dumps(needed(source)))');
  const run = spawnSync('python3', ['-c', program], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), ['dubhe_missing_a', 'dubhe_missing_b', 'dubhe_missing_c']);
});
test('demo pace includes human pauses and is slower than previous 2 chars / 28ms', () => {
  assert.ok(demoCharacterDelay('中', 0) >= 38);
  assert.ok(demoCharacterDelay('。', 0) > demoCharacterDelay('中', 0) + 180);
  assert.ok(demoCharacterDelay('，', 0, true) > 100);
});
test('shared send flight uses real composer origin, honors reduced motion, cancels safely', async () => {
  const dom = new JSDOM('<body><div id="bubble">hello</div></body>');
  const bubble = dom.window.document.querySelector('#bubble'); let frames, options, calls = 0;
  bubble.getBoundingClientRect = () => ({ left: 20, top: 30 });
  bubble.animate = (f, o) => { calls++; frames = f; options = o; return { finished: Promise.resolve(), cancel() {} }; };
  const flight = animateMessageSend(bubble, { left: 50, top: 300 });
  assert.ok(flight); assert.match(frames[0].transform, /translate\(30px, 270px\)/); assert.equal(options.duration, 560);
  dom.window.document.documentElement.dataset.motion = 'off';
  assert.equal(animateMessageSend(bubble, { left: 0, top: 0 }), null); assert.equal(calls, 1);
  assert.equal(animateMessageSend(null, null), null);
});
test('completed file folds auto-collapse even before assistant text; manual open wins', () => {
  const dom = new JSDOM('<body><div></div>'); const node = dom.window.document.querySelector('div');
  const call = { id: 'w', status: 'running' }; node._activeCalls = [call]; node.dataset.ownerId = 'a';
  const context = { messages: [{ id: 'u', role: 'user' }, { id: 'a', role: 'assistant' }], resultIds: new Set(), busy: true };
  syncEditingFold(node, context); assert.equal(node.classList.contains('expanded'), true);
  call.status = 'ok'; syncEditingFold(node, context); assert.equal(node.classList.contains('expanded'), false);
  node._userToggle = true; syncEditingFold(node, context); assert.equal(node.classList.contains('expanded'), true);
});
test('polish uses opaque ink animation, not transparent text or background clipping', () => {
  const src = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const rule = src.slice(src.indexOf('/* Shared by the conversation and homepage demo.'));
  assert.match(rule, /animation: tool-ink-polish/);
  assert.equal(rule.includes('color: transparent'), false); assert.equal(rule.includes('background-clip'), false);
});
