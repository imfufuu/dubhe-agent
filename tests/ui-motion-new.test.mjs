import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { installWelcomeMotion } from '../js/ui-welcome-motion.js';
import { renderReasoningLines } from '../js/ui-reasoning-motion.js';

function page(html) { return new JSDOM(html, { pretendToBeVisual: true }); }

test('welcome greeting has no manual refresh control; task shuffle remains separate', () => {
  const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(ui + styles, /welcome-refresh|New greeting/);
  assert.match(ui, /suggest-shuffle/);
  assert.match(ui, /pickEmptyPicks\(\)/);
});

test('welcome composer docks under the prompt while empty, returns to the bottom for a draft', () => {
  const dom = page('<main class="main"><div id="messages"><div class="empty-state"><h2 id="welcome-greeting"></h2><p id="welcome-prompt"></p></div></div><div class="composer-wrap"><textarea id="composer"></textarea></div></main>');
  const { document, Event } = dom.window;
  document.documentElement.dataset.motion = 'off';
  const main = document.querySelector('main'), messages = document.querySelector('#messages');
  const prompt = document.querySelector('#welcome-prompt'), wrap = document.querySelector('.composer-wrap');
  const composer = document.querySelector('#composer');
  main.getBoundingClientRect = () => ({ top: 0, bottom: 720, height: 720 });
  prompt.getBoundingClientRect = () => ({ top: 320, bottom: 350, height: 30 });
  wrap.getBoundingClientRect = () => ({ top: 530, bottom: 710, height: 180 });
  const welcome = installWelcomeMotion({ main, messages, composerWrap: wrap, composer });
  welcome.setGreeting('Hello, Jun', 'A short welcome.', { animate: true });
  welcome.sync({ empty: true });
  assert.equal(document.querySelector('#welcome-greeting').textContent, 'Hello, Jun');
  assert.equal(prompt.textContent, 'A short welcome.');
  assert.equal(prompt.classList.contains('is-visible'), true);
  assert.equal(main.classList.contains('welcome-docked'), true);
  assert.equal(main.style.getPropertyValue('--welcome-shift-y'), '-174px');
  composer.value = 'A draft';
  composer.dispatchEvent(new Event('input', { bubbles: true }));
  welcome.sync({ empty: true });
  assert.equal(main.classList.contains('welcome-draft'), true);
  assert.equal(main.classList.contains('welcome-docked'), false);
  assert.equal(main.style.getPropertyValue('--welcome-shift-y'), '');
  composer.value = '';
  welcome.sync({ empty: true });
  assert.equal(main.classList.contains('welcome-draft'), false);
  assert.equal(main.classList.contains('welcome-docked'), true);
  dom.window.close();
});

test('reasoning reveals source lines as safe text, preserves existing lines, and keeps summary mode separate', () => {
  const dom = page('<pre class="think-full-text"></pre><div class="think-summary-list"></div>');
  const full = dom.window.document.querySelector('.think-full-text');
  const summary = dom.window.document.querySelector('.think-summary-list');
  dom.window.document.documentElement.dataset.motion = 'off';
  renderReasoningLines(full, '<step>first</step>\nsecond line', { animate: true });
  const firstLine = full.querySelector('.reasoning-line');
  assert.equal(full.textContent, '<step>first</step>\nsecond line');
  assert.equal(full.querySelector('step'), null, 'reasoning stays escaped text, not markup');
  assert.equal(full.querySelectorAll('.reasoning-line').length, 2);
  renderReasoningLines(full, '<step>first</step>\nsecond line\nthird line', { animate: true });
  assert.equal(full.querySelector('.reasoning-line'), firstLine, 'existing lines are not rebuilt while streaming');
  assert.equal(full.textContent, '<step>first</step>\nsecond line\nthird line');
  renderReasoningLines(summary, ['Plan', 'Check constraints'], { summary: true, animate: true });
  assert.deepEqual([...summary.querySelectorAll('.think-summary-item')].map((node) => node.textContent), ['Plan', 'Check constraints']);
  assert.equal(summary.querySelector('.think-full-text'), null);
  dom.window.close();
});
