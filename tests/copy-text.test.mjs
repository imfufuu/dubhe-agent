// 第 5 项（复制无反应）：统一复制入口的降级路径。Clipboard API 不可用（非安全上下文）或被拒绝时，
// 必须回退到 execCommand('copy')，并且始终返回 boolean（绝不同步抛错导致「点了没反应」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../js/copy-text.js';

function installDom({ execOk = true } = {}) {
  const appended = [];
  const fakeDocument = {
    createElement: () => ({ style: {}, setAttribute() {}, select() {}, setSelectionRange() {}, remove() { appended.pop(); }, value: '' }),
    body: { append: (n) => appended.push(n) },
    execCommand: (cmd) => { fakeDocument.lastCommand = cmd; return execOk; },
    getSelection: () => null,
  };
  Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true, writable: true });
  return fakeDocument;
}
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

test('uses the Clipboard API when it is available', async () => {
  const doc = installDom();
  let written = null;
  setNavigator({ clipboard: { writeText: async (t) => { written = t; } } });
  globalThis.isSecureContext = true;
  assert.equal(await copyText('hello'), true);
  assert.equal(written, 'hello');
  assert.equal(doc.lastCommand, undefined, 'fallback must not run when the API succeeds');
});

test('falls back to execCommand when the Clipboard API is missing (insecure context)', async () => {
  const doc = installDom({ execOk: true });
  setNavigator({});
  globalThis.isSecureContext = false;
  assert.equal(await copyText('行一\n行二'), true);
  assert.equal(doc.lastCommand, 'copy');
});

test('falls back when the clipboard permission is denied', async () => {
  const doc = installDom({ execOk: true });
  setNavigator({ clipboard: { writeText: async () => { throw new Error('NotAllowedError'); } } });
  globalThis.isSecureContext = true;
  assert.equal(await copyText('x'), true);
  assert.equal(doc.lastCommand, 'copy');
});

test('reports failure as false instead of throwing when every path fails', async () => {
  installDom({ execOk: false });
  setNavigator({});
  globalThis.isSecureContext = false;
  assert.equal(await copyText('x'), false);
});
