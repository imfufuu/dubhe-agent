import test from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_SALUTATION_KEY,
  buildWelcomeGreeting,
  getOrCreateUserSalutation,
  normalizeUserSalutation,
  validateUserSalutation,
} from '../js/user-salutation.js';

function memoryStorage() {
  const rows = new Map();
  return {
    rows,
    getItem(key) { return rows.has(key) ? rows.get(key) : null; },
    setItem(key, value) { rows.set(key, String(value)); },
  };
}

test('random default salutation is written once and is stable across reload-style reads', () => {
  const storage = memoryStorage();
  let randomCalls = 0;
  const first = getOrCreateUserSalutation('', { storage, language: 'zh', random: () => { randomCalls++; return 0.21; } });
  const second = getOrCreateUserSalutation('', { storage, language: 'zh', random: () => { randomCalls++; return 0.91; } });
  assert.equal(second, first);
  assert.equal(storage.getItem(USER_SALUTATION_KEY), first);
  assert.equal(randomCalls, 1, 'a refresh reuses the stored alias instead of generating another');
  assert.ok(validateUserSalutation(first).ok);
});

test('a saved state value wins and is immediately persisted for the standalone setting', () => {
  const storage = memoryStorage();
  assert.equal(getOrCreateUserSalutation('  星野  ', { storage }), '星野');
  assert.equal(storage.getItem(USER_SALUTATION_KEY), '星野');
});

test('salutation validation enforces one line, supported characters and the sixteen-character limit', () => {
  assert.equal(normalizeUserSalutation('  青   禾  '), '青 禾');
  assert.equal(validateUserSalutation('').code, 'empty');
  assert.equal(validateUserSalutation('小星\n').code, 'control-character');
  assert.equal(validateUserSalutation('一二三四五六七八九十一二三四五六七').code, 'too-long');
  assert.equal(validateUserSalutation('一二三四五六七八九十一二三四五六').ok, true);
  assert.equal(validateUserSalutation('名字🙂').code, 'invalid-characters');
  assert.equal(validateUserSalutation('青禾').ok, true);
});

test('the salutation gate uses local policy rules and rejects flagged text without network access', () => {
  const priorFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => { networkCalls++; throw new Error('salutation review must stay local'); };
  try {
    for (const text of ['色情', 'fuck', 'сука']) {
      const result = validateUserSalutation(text);
      assert.equal(result.ok, false, `${text} should fail the mandatory local gate`);
      assert.equal(result.code, 'moderation');
      assert.ok(result.policy.categories.length > 0);
    }
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = priorFetch; }
});

test('welcome greetings are time-aware, randomized, and interpolate the saved salutation', () => {
  const morning = buildWelcomeGreeting('远山', 'zh', new Date(2026, 5, 4, 8), () => 0);
  const otherMorning = buildWelcomeGreeting('远山', 'zh', new Date(2026, 5, 4, 8), () => 0.99);
  const english = buildWelcomeGreeting('Nova', 'en', new Date(2026, 5, 4, 8), () => 0);
  assert.match(morning.title, /远山/);
  assert.match(morning.title, /早上好|早安|新的一天/);
  assert.notEqual(morning.title, otherMorning.title);
  assert.match(english.title, /Nova/);
  assert.match(english.title, /Good morning|Morning|A fresh start/);
  assert.ok(morning.prompt);
});
