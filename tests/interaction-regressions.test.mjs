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
  let sent = ''; let sendOptions; const warnings = [];
  const handler = installChoiceHandler({ root, store, agent: { send: (text, attachments, options) => { sent = text; sendOptions = options; } }, getBusy: () => false, openKeyModal: () => {}, toast: text => warnings.push(text) });
  const click = selector => handler({ target: box.querySelector(selector) });
  click('[data-choice-send="A"]'); assert.equal(sent, '');
  box.querySelectorAll('.choice-other')[1].value = 'extra';
  click('[data-choice-back]'); click('[data-choice-send="B"]');
  click('[data-choice-submit]');
  assert.deepEqual(sendOptions, { choiceReply: true });
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
  assert.match(fileCardIconHtml({ name: 'report.pdf' }), /file-icons\/pdf\.svg/);
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
    document.querySelector('.pm-tree-row.file').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true }));
    document.querySelector('[data-action=rename]').click(); await Promise.resolve();
    const input = document.querySelector('.pm-input'); input.value = 'new.js'; input.dispatchEvent(new dom.window.Event('blur'));
    assert.ok(Object.hasOwn(store.state.files, 'src/new.js')); assert.equal(Object.hasOwn(store.state.files, 'src/old.js'), false);
    // The selected (empty) file is not confused with a directory.
    document.querySelector('.pm-tree-row.dir').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true }));
    document.querySelector('[data-action=new-file]').click(); await Promise.resolve();
    const create = document.querySelector('.pm-tree-row.create .pm-input'); create.value = 'other.txt';
    create.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.ok(Object.hasOwn(store.state.files, 'src/other.txt'));
  } finally {
    await instance?.close(); dom.window.close(); Object.assign(globalThis, previous);
  }
});


test('choice replies remain in model context but are not separate share entries', async () => {
  const { buildOpenAIMessages } = await import('../js/api.js');
  const { shareableMessages } = await import('../js/ui-share.js');
  const reply = { id: 'r', role: 'user', text: 'Question\nAnswer', choiceReply: true };
  assert.match(JSON.stringify(buildOpenAIMessages([reply])), /Question/);
  assert.equal(shareableMessages([reply]).length, 0);
  assert.equal(shareableMessages([{ ...reply, choiceReply: false }]).length, 1);
});

test('foreground workspace drops hidden page selections without disabling native selection', async () => {
  const { focusForegroundWorkspace } = await import('../js/modal-selection.js');
  const dom = new JSDOM('<p id="behind">hidden content</p><section id="modal"><textarea>editable text</textarea></section>');
  const doc = dom.window.document, range = doc.createRange();
  range.selectNodeContents(doc.querySelector('#behind'));
  doc.getSelection().addRange(range);
  const root = doc.querySelector('#modal');
  focusForegroundWorkspace(root, doc);
  assert.equal(doc.getSelection().toString(), '');
  assert.equal(doc.activeElement, root);
  const input = root.querySelector('textarea'); input.focus(); input.setSelectionRange(0, 8);
  assert.equal(input.value.slice(input.selectionStart, input.selectionEnd), 'editable');
  dom.window.close();
});

test('new BabelStone faces are selectable and preserved in offline share font selection', async () => {
  const { selectLazyFaces, codepointsOf } = await import('../js/lazy-fonts.js');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../assets/fonts-lazy/index.css', import.meta.url), 'utf8');
  for (const [sample, expected] of [['A', 'roman.woff2'], ['𘀀', 'wenhai.woff2'], ['𘬀', 'khitan.ttf'], ['🇺🇸', 'flags.woff2'], ['\uE000', 'goblin.woff2']]) {
    assert.ok(selectLazyFaces(css, codepointsOf(sample)).some(face => face.url.includes(expected)), expected);
  }
  const styles = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const mono = /--mono:\s*([^;]+)/.exec(styles)[1];
  assert.ok(mono.indexOf('BabelStone Han Extra') < mono.indexOf('ui-monospace'));
});


test('turn attachment preparation isolates moderation frames without mutating the caller', async () => {
  const { prepareTurnAttachments } = await import('../js/turn-input.js');
  const video = { name: 'clip.mp4', source: 'video', frames: ['frame1'], poster: 'poster' };
  const plain = { name: 'plain.txt', text: 'hello' };
  const result = prepareTurnAttachments([video, plain]);
  assert.deepEqual(video.frames, ['frame1']);
  assert.equal('frames' in result.attachments[0], false);
  assert.deepEqual(result.forModeration[0].frames, ['frame1']);
  assert.equal(result.attachments[1], plain);
});


test('share snapshot includes the saved choice summary, not live buttons', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  try {
    const { snapshotMessage } = await import('../js/share-document.js');
    const message = { id: 'a', role: 'assistant', text: ':::choice Pick\n- Yes\n- No\n:::', choiceResults: { 0: [{ question: 'Pick', answer: 'Yes' }] } };
    const result = snapshotMessage(message, [message], { read() { return null; } });
    assert.match(result.textContent, /Pick/);
    assert.match(result.textContent, /Yes/);
    assert.equal(result.querySelector('[data-choice-submit]'), null);
    assert.ok(result.querySelector('.choice-result'));
  } finally { globalThis.document = previous; dom.window.close(); }
});

test('project explorer context actions, drag, zip and unsaved dialogs preserve data', async () => {
  const { openProjectMode } = await import('../js/project-mode.js');
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/', pretendToBeVisual: true });
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.getComputedStyle = dom.window.getComputedStyle;
  dom.window.confirm = () => true;
  const store = { state: { files: { 'a-empty/.keep': '', 'docs/file.txt': 'saved', 'target/.keep': '' } } };
  const agent = { sandboxWrite(path, value) { store.state.files = { ...store.state.files, [path]: value }; }, sandboxRemove(path) { const next = { ...store.state.files }; delete next[path]; store.state.files = next; } };
  let instance;
  const row = path => [...document.querySelectorAll('.pm-tree-row')].find(el => el.getAttribute('data-path') === path);
  const menu = (path, action) => { row(path).dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); const b = document.querySelector(`[data-action="${action}"]`); assert.ok(b, `${action} on ${path}`); b.click(); };
  const wait = async condition => { for (let i = 0; i < 50 && !condition(); i++) await new Promise(r => setTimeout(r, 10)); assert.ok(condition()); };
  try {
    instance = openProjectMode({ store, agent });
    assert.equal(document.querySelector('.pm-tab-name').textContent, 'file.txt', '.keep must never be opened as an editor tab');
    assert.equal(document.querySelector('.pm-tree-row[title="a-empty/.keep"]'), null);
    const editor = document.querySelector('.pm-text'); editor.value = 'unsaved'; editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.match(document.querySelector('.pm-st-dirty').textContent, /未保存|Unsaved/);
    document.querySelector('.pm-tab .pm-mini').click();
    assert.ok(document.querySelector('.pm-confirm'), 'closing a dirty tab asks to save, discard or cancel');
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await Promise.resolve();
    assert.equal(document.querySelector('.pm-confirm'), null, 'Escape cancels only the active dialog');
    assert.equal(editor.value, 'unsaved');
    menu('docs/file.txt', 'copy'); menu('target', 'paste');
    assert.equal(store.state.files['target/file.txt'], 'unsaved', 'copy includes the editor buffer');
    menu('docs/file.txt', 'cut');
    const source = row('docs/file.txt'), target = row('a-empty');
    const dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
    const drag = new dom.window.Event('dragstart', { bubbles: true }); Object.defineProperty(drag, 'dataTransfer', { value: dataTransfer }); source.dispatchEvent(drag);
    const drop = new dom.window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer }); target.dispatchEvent(drop);
    assert.equal(store.state.files['a-empty/file.txt'], 'saved');
    assert.equal(store.state.files['docs/file.txt'], undefined);
    assert.equal(document.querySelector('.pm-tab-name').textContent, 'file.txt');
    assert.equal(editor.value, 'unsaved', 'moving preserves the dirty tab');
    document.querySelector('.pm-tab .pm-mini').click();
    assert.ok(document.querySelector('.pm-confirm'));
    document.querySelector('.pm-confirm .pm-btn.primary').click(); await Promise.resolve();
    assert.equal(store.state.files['a-empty/file.txt'], 'unsaved', 'save uses the moved path');
    menu('a-empty/file.txt', 'compress');
    await wait(() => !!store.state.files['a-empty/file.txt.zip']);
    // An existing folder must never be overwritten; extraction is into a separate folder.
    agent.sandboxRemove('a-empty/file.txt');
    await new Promise(r => setTimeout(r, 950));
    menu('a-empty/file.txt.zip', 'extract');
    await wait(() => store.state.files['a-empty/file.txt/file.txt'] === 'unsaved');
    const old = { ...store.state.files };
    menu('a-empty/file.txt.zip', 'extract'); await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(store.state.files, old, 'existing extraction destination is not overwritten');
    // Touch long-press opens the same menu.
    const touch = new dom.window.Event('pointerdown', { bubbles: true });
    Object.defineProperties(touch, { pointerType: { value: 'touch' }, clientX: { value: 5 }, clientY: { value: 5 } });
    row('target').dispatchEvent(touch); await new Promise(r => setTimeout(r, 590));
    assert.ok(document.querySelector('[data-action="paste"]'), 'long press opens the folder menu');
  } finally { if (instance) { const pending = instance.close(); document.querySelector('.pm-confirm-acts button:nth-child(2)')?.click(); await pending; } dom.window.close(); Object.assign(globalThis, previous); }
});

test('empty project never opens its internal folder placeholder', async () => {
  const { openProjectMode } = await import('../js/project-mode.js');
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.getComputedStyle = dom.window.getComputedStyle;
  const store = { state: { files: { 'empty/.keep': '' } } };
  const agent = { sandboxWrite() {}, sandboxRemove() {} };
  let instance;
  try { instance = openProjectMode({ store, agent }); assert.equal(document.querySelector('.pm-tab'), null); assert.equal(document.querySelector('.pm-text').hidden, true); }
  finally { await instance?.close(); dom.window.close(); Object.assign(globalThis, previous); }
});

test('failed move retains destination backups if restoring removed source fails', async () => {
  const { openProjectMode } = await import('../js/project-mode.js');
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.getComputedStyle = dom.window.getComputedStyle;
  const store = { state: { files: { 'src/a.txt': 'a', 'src/b.txt': 'b', 'dest/.keep': '' } } }; let failRestore = false;
  const agent = {
    sandboxWrite(path, value) { if (failRestore && path === 'src/a.txt') throw new Error('restore failed'); store.state.files = { ...store.state.files, [path]: value }; },
    sandboxRemove(path) { if (path === 'src/b.txt') { failRestore = true; throw new Error('delete failed'); } const next = { ...store.state.files }; delete next[path]; store.state.files = next; },
  };
  let instance;
  const menu = (path, action) => { const row = [...document.querySelectorAll('.pm-tree-row')].find(el => el.dataset.path === path); row.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true })); document.querySelector(`[data-action="${action}"]`).click(); };
  try {
    instance = openProjectMode({ store, agent });
    menu('src', 'cut'); menu('dest', 'paste'); await Promise.resolve();
    assert.equal(store.state.files['dest/src/a.txt'], 'a', 'the remaining copy survives a failed source restoration');
    assert.equal(store.state.files['dest/src/b.txt'], 'b');
    assert.equal(store.state.files['src/b.txt'], 'b');
    assert.match(document.querySelector('.pm-st-msg').textContent, /回滚不完整|rollback was incomplete/);
  } finally { if (instance) { const pending = instance.close(); document.querySelector('.pm-confirm-acts button:nth-child(2)')?.click(); await pending; } dom.window.close(); Object.assign(globalThis, previous); }
});

test('dirty deletion asks for confirmation and closing project can cancel or discard', async () => {
  const { openProjectMode } = await import('../js/project-mode.js');
  const dom = new JSDOM('<body></body>', { url: 'https://example.com/' });
  const previous = { document: globalThis.document, window: globalThis.window, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.getComputedStyle = dom.window.getComputedStyle;
  dom.window.confirm = () => false;
  const store = { state: { files: { 'docs/file.txt': 'old' } } };
  const agent = { sandboxWrite(path, value) { store.state.files = { ...store.state.files, [path]: value }; }, sandboxRemove(path) { delete store.state.files[path]; } };
  let instance;
  try {
    instance = openProjectMode({ store, agent });
    const editor = document.querySelector('.pm-text'); editor.value = 'dirty'; editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    const unload = new dom.window.Event('beforeunload', { cancelable: true }); dom.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true, 'navigation warns about unsaved changes');
    document.querySelector('[data-path="docs/file.txt"]').dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true }));
    document.querySelector('[data-action="delete"]').click();
    assert.equal(store.state.files['docs/file.txt'], 'old'); assert.equal(editor.value, 'dirty');
    const close1 = instance.close(); document.querySelector('.pm-confirm-acts button').click(); await close1;
    assert.ok(document.querySelector('.pm-root')); assert.equal(editor.value, 'dirty');
    const close2 = instance.close(); document.querySelector('.pm-confirm-acts button:nth-child(2)').click(); await close2;
    assert.ok(document.querySelector('.pm-root.pm-leaving')); assert.equal(store.state.files['docs/file.txt'], 'old');
    instance = null;
  } finally { if (instance) { const pending = instance.close(); document.querySelector('.pm-confirm-acts button:nth-child(2)')?.click(); await pending; } dom.window.close(); Object.assign(globalThis, previous); }
});
