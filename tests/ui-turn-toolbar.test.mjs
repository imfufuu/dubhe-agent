import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { settleTurnToolbars } from '../js/ui-turn-toolbar.js';

function makeTurn() {
  const dom = new JSDOM(`<!doctype html><div id="messages">
    <div class="msg" data-id="a1"><div class="message-tail"></div><div class="msg-toolbar"><div class="msg-actions"><button>Old copy action</button></div><div class="msg-foot mono">High · 2 s</div></div></div>
    <div class="msg" data-id="a2"><div class="message-tail"></div><div class="msg-toolbar"><div class="msg-actions"><button>Final copy action</button></div><div class="msg-foot mono">Medium · 1 s</div></div></div>
  </div>`);
  return { dom, root: dom.window.document.querySelector('#messages') };
}

test('a multi-assistant turn keeps one action toolbar and each assistant message metadata', () => {
  const { dom, root } = makeTurn();
  try {
    settleTurnToolbars(root, [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant' },
      { id: 'a2', role: 'assistant' },
    ]);
    const first = root.querySelector('[data-id="a1"]');
    const last = root.querySelector('[data-id="a2"]');
    const retainedAction = last.querySelector('.msg-actions button');
    let clicks = 0;
    retainedAction.addEventListener('click', () => { clicks++; });
    assert.equal(first.querySelector('.msg-actions'), null, 'old action controls are removed, not duplicated');
    assert.equal(first.querySelector('.msg-foot').textContent, 'High · 2 s', 'first assistant metadata remains attached to its message');
    assert.equal(last.querySelectorAll('.msg-actions button').length, 1, 'final assistant keeps its interactive action button');
    assert.equal(last.querySelector('.msg-foot').textContent, 'Medium · 1 s');
    assert.equal(root.querySelectorAll('.msg-actions button').length, 1, 'only one action set remains for the turn');
    retainedAction.click();
    assert.equal(clicks, 1, 'the retained action button keeps its interaction handler');
  } finally { dom.window.close(); }
});

test('empty metadata-only toolbars are discarded while a visible per-message footer stays', () => {
  const dom = new JSDOM(`<!doctype html><div id="messages">
    <div class="msg" data-id="a1"><div class="msg-toolbar"><div class="msg-actions"><button>Old</button></div><div class="msg-foot" hidden></div></div></div>
    <div class="msg" data-id="a2"><div class="msg-toolbar"><div class="msg-actions"><button>Final</button></div><div class="msg-foot">Final metadata</div></div></div>
  </div>`);
  try {
    const root = dom.window.document.querySelector('#messages');
    settleTurnToolbars(root, [
      { id: 'u1', role: 'user' },
      { id: 'a1', role: 'assistant', toolCalls: [{ id: 'call' }] },
      { id: 'a2', role: 'assistant' },
    ]);
    assert.equal(root.querySelector('[data-id="a1"] .msg-toolbar'), null);
    assert.ok(root.querySelector('[data-id="a2"] .msg-toolbar'));
  } finally { dom.window.close(); }
});
