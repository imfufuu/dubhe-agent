// 回归：思考块（.reasoning）与正文（.md-body）不得互相覆盖；思考自动展开 / 用户可手动展开 / 总结正文不消失
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
// 用 jsdom 真实挂载 index.html + mountUI，驱动关键交互路径，验证「接线」是否正确
// （元素 id、事件绑定、渲染分支、状态机动画、下载与文件面板）。
// 依赖 jsdom（npm ci 会装；CI 必跑本文件，未安装时本地自动跳过）。
//   node tests/dom-smoke.mjs          # 需 npm i -D jsdom
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const { imageFamilyOf } = await import('../js/config.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('跳过 DOM 冒烟测试：未安装 jsdom（npm i -D jsdom 后可运行）');
  process.exit(0);
}

const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8000/', pretendToBeVisual: true });
const { window } = dom;
// Legacy Chinese contracts are explicit; separate feature/browser tests exercise auto English.
Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });

for (const k of ['document', 'window', 'location', 'navigator', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'URL', 'Blob', 'FormData', 'File']) {
  // Node ≥ 21 自带只读 getter 的 globalThis.navigator，直接赋值会抛 TypeError（CI 跑 Node 22 时暴露）：改用 defineProperty 覆盖
  if (window[k] !== undefined) Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true, enumerable: true });
}
globalThis.self = window;
globalThis.localStorage = window.localStorage;
// 破坏性操作都带 confirm()；测试里按需切换返回值
let confirmAnswer = true;
window.confirm = () => confirmAnswer;
globalThis.confirm = window.confirm;
// jsdom 未实现的浏览器 API 补齐（不影响被测代码路径的正确性）
if (!window.matchMedia) window.matchMedia = (q) => ({ media: q, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.matchMedia = window.matchMedia;
if (!window.CSS?.escape) { window.CSS = window.CSS || {}; window.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`); }
globalThis.CSS = window.CSS;
window.Element.prototype.scrollTo = function () {};
window.Element.prototype.scrollIntoView = function () {};
if (typeof window.URL.createObjectURL !== 'function') window.URL.createObjectURL = () => 'blob:jsdom-mock';
if (typeof window.URL.revokeObjectURL !== 'function') window.URL.revokeObjectURL = () => {};

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name} ${extra}`); }
};

const { createStore } = await import(path.join(ROOT, 'js/state.js'));
const { createAgent, copyAttachmentsToFS } = await import(path.join(ROOT, 'js/agent.js'));
const { mountUI } = await import(path.join(ROOT, 'js/ui.js'));
const { ROUTER_ICON_SVG } = await import(path.join(ROOT, 'js/smartrouter.js'));
const { createZip } = await import(path.join(ROOT, 'js/zip.js'));
const { createXlsxWorkbook } = await import(path.join(ROOT, 'js/xlsx.js'));

const store = createStore();
store.state.apiKey = 'sk-teamo-test';
// 复刻 main.js 的接线（agent hooks → ui 方法），用于验证「用户消息立刻上屏」
const lateUI = {};
const agent = createAgent(store, {
  onUserMessage: (text, msg) => lateUI.onUserMessage && lateUI.onUserMessage(text, msg),
});
let bootCompletionCount = 0;
window.__dubheBootGuard = { complete() { bootCompletionCount++; } };
const ui = mountUI(store, agent);
lateUI.onUserMessage = (text, msg) => ui.onUserMessage(msg);
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const click = (n) => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const U = { id: 'u1', role: 'user', text: 'q', ts: Date.now() };
const A = (over) => ({ id: 'a1', role: 'assistant', model: 'claude-sonnet-5', reasoningLevel: 'high', ts: Date.now(), ...over });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nodeOf = () => $('#messages [data-id="a1"]');
const bodyOf = () => nodeOf().querySelector(':scope > .md-body');

// 真实流式路径：同一个消息节点被反复重绘（onAssistantStart → onReasoning → onDelta → onAssistantDone）。
// 旧实现用裸选择器 $('.md-body', wrap)，重绘时会命中思考块里的 .think-full-text.md-body，
// 结果正文被写进折叠的思考详情，真正的正文容器一直是空的（总结消失、思考无法正常展开）。
test('流式重绘：正文始终写入消息自己的 .md-body，思考详情只放思考内容', async () => {
  agent.getStatus = () => 'thinking';
  store.state.messages.splice(0, store.state.messages.length, U);
  ui.rebuildMessages();
  const m = A({ reasoning: 'live thinking', text: '', done: false, thinkDone: false });
  store.state.messages.push(m);
  ui.onAssistantStart(m); await sleep(60);
  let r = nodeOf().querySelector('.reasoning');
  assert.equal(r.classList.contains('expanded'), true, '思考进行中应自动展开');
  m.reasoning += ' more'; ui.onReasoning(m); await sleep(60);
  m.text = 'REDRAW-ANSWER'; m.thinkDone = true; ui.onDelta(m); await sleep(60);
  assert.equal(bodyOf().textContent.trim(), 'REDRAW-ANSWER', '正文开始流式后必须出现在正文区');
  const detail = nodeOf().querySelector('.reasoning .think-full-text');
  assert.ok(!detail || !detail.textContent.includes('REDRAW-ANSWER'), '正文不得写入思考详情');
  r = nodeOf().querySelector('.reasoning');
  assert.equal(r.classList.contains('expanded'), false, '正文开始后思考收起');
  r.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(nodeOf().querySelector('.reasoning').classList.contains('expanded'), true, '用户点击应能展开思考');
  m.done = true; agent.getStatus = () => 'idle'; ui.onAssistantDone(m); await sleep(60);
  assert.equal(bodyOf().textContent.trim(), 'REDRAW-ANSWER', '完成后正文仍然在');
});

// 工具调用（多段 flow 结构）后的总结正文不消失
test('工具调用后的总结正文不消失', () => {
  agent.getStatus = () => 'idle';
  store.state.messages.splice(0, store.state.messages.length, U,
    A({ reasoning: 'think then tool', text: 'SUMMARY-TOOL', toolCalls: [{ id: 'c1', name: 'execute_python', args: { code: '1' }, status: 'ok', settled: true }], done: true, thinkDone: true }),
    { id: 't1', role: 'tool', toolCallId: 'c1', content: 'ok', ts: Date.now() });
  ui.rebuildMessages();
  assert.ok((nodeOf().textContent || '').includes('SUMMARY-TOOL'));
});

// 挂载的 UI 会留下定时器；测试结束后延时退出，确保 TAP 输出已刷新（与 dom-smoke 的收尾一致）
after(() => new Promise((resolve) => setTimeout(() => { process.exit(process.exitCode || 0); resolve(); }, 300)));
