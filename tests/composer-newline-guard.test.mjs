import test from 'node:test';
import assert from 'node:assert/strict';
import { installShiftEnterGuard } from '../js/composer-newline-guard.js';

class FakeComposer {
  constructor(value = '') {
    this.value = value;
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
    this.listeners = new Map();
  }
  addEventListener(name, fn) {
    const list = this.listeners.get(name) || [];
    list.push(fn);
    this.listeners.set(name, list);
  }
  dispatch(name, event = {}) {
    for (const fn of this.listeners.get(name) || []) fn({ key: '', ...event });
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}

test('Shift+Enter preserves one newline and collapses duplicate newline insertion to one', () => {
  const composer = new FakeComposer();
  let inputUpdates = 0;
  const guard = installShiftEnterGuard(composer, () => { inputUpdates++; });
  guard.capture();
  composer.value = '\n';
  composer.selectionStart = composer.selectionEnd = 1;
  composer.dispatch('input');
  assert.equal(composer.value, '\n');
  composer.dispatch('keyup', { key: 'Enter' });

  composer.value = '';
  composer.selectionStart = composer.selectionEnd = 0;
  guard.capture();
  composer.value = '\n\n';
  composer.selectionStart = composer.selectionEnd = 2;
  composer.dispatch('input');
  assert.equal(composer.value, '\n');
  assert.deepEqual([composer.selectionStart, composer.selectionEnd], [1, 1]);
  assert.equal(inputUpdates, 2);
});

test('duplicate Shift+Enter newlines are normalized at the caret without disturbing surrounding text', () => {
  const composer = new FakeComposer('prefixsuffix');
  composer.selectionStart = composer.selectionEnd = 6;
  const guard = installShiftEnterGuard(composer);
  guard.capture();
  composer.value = 'prefix\n\nsuffix';
  composer.selectionStart = composer.selectionEnd = 8;
  composer.dispatch('input');
  assert.equal(composer.value, 'prefix\nsuffix');
  assert.deepEqual([composer.selectionStart, composer.selectionEnd], [7, 7]);
});
