import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown, hydrateSandboxMedia } from '../js/ui-markdown.js';
import { installChoiceHandler, choiceSummaryHtml } from '../js/ui-choices.js';
import { recordChecklistCall } from '../js/checklist.js';
import { placeChecklistCompletion } from '../js/ui-toolflow.js';
import { isCnUnavailableModel, gatewayRequest } from '../js/api.js';
import { setGatewayBase, gatewayBase } from '../js/endpoint.js';
import { createMessageScrollManager } from '../js/ui-message-scroll.js';
import { fileCardIconHtml } from '../js/file-card.js';
import { createAssistantFootPainter } from '../js/ui-foot.js';

test('choices wait for submit, preserve back navigation and other text, and persist a summary', () => {
  const html = renderMarkdown(':::choice First\n- ![A](sandbox:img/a.png)\n- B\n:::\n\n:::choice Second\n- C\n- D\n:::');
  const dom = new JSDOM(`<div id="root"><div class="msg" data-id="a">${html}</div></div>`);
  const root = dom.window.document.querySelector('#root');
  const box = root.querySelector('.choice-box');
  hydrateSandboxMedia(box, { read: () => 'data:image/png;base64,AAAA' });
  assert.match(box.querySelector('img').src, /^data:image\/png/);
  const msg = { id: 'a', role: 'assistant', done: true };
  const store = { state: { messages: [msg], apiKey: 'key', model: 'test' }, updateMessage(id, patch) { Object.assign(msg, patch); } };
  let sent = ''; const warnings = [];
  const handler = installChoiceHandler({ root, store, agent: { send: text => { sent = text; } }, getBusy: () => false, openKeyModal: () => {}, toast: text => warnings.push(text) });
  const click = selector => handler({ target: box.querySelector(selector) });
  click('[data-choice-send="A"]'); assert.equal(sent, '');
  box.querySelectorAll('.choice-other')[1].value = 'extra';
  click('[data-choice-back]'); click('[data-choice-send="B"]');
  click('[data-choice-submit]');
  assert.match(sent, /First\nB/); assert.match(sent, /Second[\s\S]*extra/);
  assert.equal(msg.choiceResults[0][0].answer, 'B');
  const summary = choiceSummaryHtml(msg.choiceResults[0]);
  assert.match(summary, /First/); assert.match(summary, /extra/); assert.match(summary, /choice-result-row/g);
  assert.match(choiceSummaryHtml([{ question: 'First' }], true), /First[\s\S]*(未回答|Not answered)/);
  assert.equal(warnings.length, 0);
});

test('incomplete choices are not submitted and unsafe image URLs are never rendered', () => {
  const html = renderMarkdown(':::choice Q\n- ![X](javascript:alert)\n- Y\n:::');
  assert.doesNotMatch(html, /<img[^>]+javascript:/);
  const dom = new JSDOM(`<div id="root"><div class="msg" data-id="a">${html}</div></div>`);
  const root = dom.window.document.querySelector('#root'); let sent = false, warning = false;
  const msg = { id: 'a', role: 'assistant', done: true };
  const handler = installChoiceHandler({ root, store: { state: { messages: [msg], apiKey: 'key' } }, agent: { send() { sent = true; } }, getBusy: () => false, openKeyModal() {}, toast() { warning = true; } });
  handler({ target: root.querySelector('[data-choice-submit]') });
  assert.equal(sent, false); assert.equal(warning, true);
});

test('checklist completion belongs to the assistant containing the completing tool call', () => {
  const first = { id: 'first', role: 'assistant', toolCalls: [{ id: 'create', name: 'checklist' }] };
  const last = { id: 'last', role: 'assistant', toolCalls: [{ id: 'finish', name: 'checklist' }] };
  const store = { state: { messages: [first, last] }, updateMessage(id, patch) { Object.assign(this.state.messages.find(m => m.id === id), patch); } };
  recordChecklistCall(store, 'first', { items: [{ text: 'Task', status: 'pending' }] }, 'create');
  recordChecklistCall(store, 'first', { items: [{ text: 'Task', status: 'done' }] }, 'finish');
  assert.equal(first.checklistDoneMessageId, 'last');
  const dom = new JSDOM('<div id="first"><div class="msg-head"></div></div><div id="last"><div class="msg-head"></div><div class="assistant-flow"><div class="assistant-fragment" data-part="0"></div></div></div>');
  const a = dom.window.document.querySelector('#first'), b = dom.window.document.querySelector('#last');
  placeChecklistCompletion(a, first); placeChecklistCompletion(b, last);
  assert.equal(a.querySelector('[data-stage="completed"]'), null);
  assert.ok(b.querySelector('.assistant-fragment [data-stage="completed"]'));
  recordChecklistCall(store, 'first', { items: [{ text: 'Task', status: 'pending' }] }, 'finish');
  assert.equal(last.checklistCompletion, null);
});

test('regional model check blocks mainland requests and does not block domestic or other gateways', async () => {
  assert.equal(isCnUnavailableModel('https://api.teamorouter.cn/v1/chat/completions', 'claude-sonnet-5'), true);
  assert.equal(isCnUnavailableModel('https://api.teamorouter.cn/v1/chat/completions', 'deepseek-flash'), false);
  assert.equal(isCnUnavailableModel('https://api.teamorouter.com/v1/chat/completions', 'gpt-5'), false);
  const oldBase = gatewayBase(), oldFetch = globalThis.fetch; let requests = 0;
  try {
    setGatewayBase('https://api.teamorouter.cn');
    globalThis.fetch = async () => { requests++; return new Response('{}'); };
    await assert.rejects(gatewayRequest('/v1/chat/completions', { body: JSON.stringify({ model: 'gpt-5' }) }), /该模型在当前地区不可用|not available in the current region/);
    assert.equal(requests, 0);
    await gatewayRequest('/v1/chat/completions', { body: JSON.stringify({ model: 'qwen3' }) });
    assert.equal(requests, 1);
  } finally { globalThis.fetch = oldFetch; setGatewayBase(oldBase); }
});

test('follow stays at tail as content grows, but respects an intentional scroll up', () => {
  const dom = new JSDOM('<div id="list"></div><button id="jump"></button>');
  const list = dom.window.document.querySelector('#list');
  let height = 500, top = 0;
  Object.defineProperties(list, { clientHeight: { value: 100 }, scrollHeight: { get: () => height }, scrollTop: { get: () => top, set: v => { top = Math.max(0, Math.min(v, height - 100)); } } });
  list.scrollTo = ({ top: value }) => { list.scrollTop = value; };
  const manager = createMessageScrollManager({ msgList: list, jumpBtn: dom.window.document.querySelector('#jump') });
  manager.jumpToBottom(); height = 1000; manager.scrollToBottom(); assert.equal(top, 900);
  list.scrollTop = 200; list.dispatchEvent(new dom.window.Event('scroll')); height = 1200; manager.scrollToBottom(); assert.equal(top, 200);
  dom.window.document.querySelector('#jump').click(); assert.equal(top, 1100);
  list.dispatchEvent(new dom.window.Event('scroll')); height = 1400; manager.scrollToBottom(); assert.equal(top, 1300);
});

test('document icons use SVG and moderator footer never inherits another message reasoning', () => {
  assert.match(fileCardIconHtml({ name: 'report.pdf' }), /<svg/);
  const dom = new JSDOM('<div><div class="msg-foot"></div></div>');
  const msg = { id: 'moderator', role: 'assistant', model: 'Moderator', done: true };
  createAssistantFootPainter({ state: { messages: [{ id: 'a', role: 'assistant', reasoning: 'thought' }, msg] } })(dom.window.document.querySelector('div'), msg);
  assert.equal(dom.window.document.querySelector('.msg-foot').hidden, true);
});

test('fullscreen viewer escapes a transformed panel and returns to its original location', async () => {
  const { setViewerFullscreen } = await import('../js/ui-files-panel.js');
  const dom = new JSDOM('<html data-motion="off"><body><div id="panel" style="transform:translateX(1px)"><i></i><div id="file-viewer"><button id="fv-full"></button></div><b></b></div></body></html>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const viewer = document.querySelector('#file-viewer'), panel = document.querySelector('#panel');
    setViewerFullscreen(viewer, true);
    assert.equal(viewer.parentNode, document.body); assert.equal(viewer.classList.contains('fv-fullscreen'), true);
    setViewerFullscreen(viewer, false);
    assert.equal(viewer.parentNode, panel); assert.equal(viewer.previousElementSibling.tagName, 'I'); assert.equal(viewer.nextElementSibling.tagName, 'B');
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('project mode renames on blur and creates an empty file in the selected directory', async () => {
  const { openProjectMode } = await import('../js/project-mode.js');
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.getComputedStyle = dom.window.getComputedStyle;
  const store = { state: { files: { 'src/old.js': '' } } };
  const agent = { sandboxWrite(path, value) { store.state.files = { ...store.state.files, [path]: value }; }, sandboxRemove(path) { const next = { ...store.state.files }; delete next[path]; store.state.files = next; } };
  let instance;
  try {
    instance = openProjectMode({ store, agent });
    const rename = document.querySelector('.pm-tree-row.file .pm-mini'); rename.click(); await Promise.resolve();
    const input = document.querySelector('.pm-input'); input.value = 'new.js'; input.dispatchEvent(new dom.window.Event('blur'));
    assert.ok(Object.hasOwn(store.state.files, 'src/new.js')); assert.equal(Object.hasOwn(store.state.files, 'src/old.js'), false);
    // The selected (empty) file is not confused with a directory.
    document.querySelector('[aria-label="新建文件"], [aria-label="New file"]').click(); await Promise.resolve();
    const create = document.querySelector('.pm-tree-row.create .pm-input'); create.value = 'other.txt';
    create.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.ok(Object.hasOwn(store.state.files, 'src/other.txt'));
  } finally {
    await instance?.close(); dom.window.close(); Object.assign(globalThis, previous);
  }
});
