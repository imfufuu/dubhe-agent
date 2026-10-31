import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { revealChunks } from '../js/ui-chunks.js';

function fixture(html = '') {
  const dom = new JSDOM(`<main id="body">${html}</main>`, { pretendToBeVisual: true });
  const frames = [];
  dom.window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  const root = dom.window.document.querySelector('#body');
  const state = {};
  return { dom, root, state, frames };
}

test('new paragraph fades in as a block; later appended text in the same paragraph gets its own span', () => {
  const { dom, root, state, frames } = fixture('<p>First piece</p>');
  revealChunks(root, state, true);
  const first = root.firstElementChild;
  assert.equal(first.classList.contains('chunk'), true);
  assert.equal(first.querySelector('.chunk-tail'), null);
  // 新块同步加 .in（不依赖 rAF，避免被下一轮重绘吞掉，见 ui-chunks.js）
  assert.equal(first.classList.contains('in'), true);
  assert.equal(frames.length, 0);

  root.innerHTML = '<p>First piece, then more streamed text.</p>';
  revealChunks(root, state, true);
  const paragraph = root.firstElementChild;
  const tail = paragraph.querySelector('.chunk-tail');
  assert.ok(tail, 'the new suffix should be isolated for animation');
  assert.equal(tail.textContent, ', then more streamed text.');
  assert.equal(paragraph.textContent, 'First piece, then more streamed text.');
  assert.equal(paragraph.classList.contains('chunk'), false, 'existing paragraph must not be re-faded');
  assert.equal(frames.length, 0, 'tail animation is CSS-driven, not a block transition');
  dom.window.close();
});

test('streamed suffix spanning inline Markdown nodes is animated without losing markup', () => {
  const { dom, root, state } = fixture('<p>Alpha </p>');
  revealChunks(root, state, true);
  root.innerHTML = '<p>Alpha <strong>bold text</strong> and <em>emphasis</em></p>';
  revealChunks(root, state, true);

  const paragraph = root.firstElementChild;
  assert.equal(paragraph.textContent, 'Alpha bold text and emphasis');
  assert.equal(paragraph.querySelector('strong').textContent, 'bold text');
  assert.equal(paragraph.querySelector('em').textContent, 'emphasis');
  assert.deepEqual([...paragraph.querySelectorAll('.chunk-tail')].map((node) => node.textContent), ['bold text', ' and ', 'emphasis']);
  dom.window.close();
});

test('a newly appended Markdown block gets the normal block animation, not a duplicate tail animation', () => {
  const { dom, root, state } = fixture('<p>One</p>');
  revealChunks(root, state, true);
  root.innerHTML = '<p>One</p><p>Two</p>';
  revealChunks(root, state, true);

  assert.equal(root.children[1].classList.contains('chunk'), true);
  assert.equal(root.children[1].querySelector('.chunk-tail'), null);
  assert.equal(root.children[1].classList.contains('in'), true);
  dom.window.close();
});

test('the first text added to an existing empty paragraph is treated as a streamed suffix', () => {
  const { dom, root, state } = fixture('<p></p>');
  revealChunks(root, state, true);
  root.innerHTML = '<p>Text arrives later</p>';
  revealChunks(root, state, true);
  assert.equal(root.querySelector('.chunk-tail')?.textContent, 'Text arrives later');
  assert.equal(root.firstElementChild.textContent, 'Text arrives later');
  dom.window.close();
});

test('a rewrite or non-streaming repaint is not mistaken for an appended suffix', () => {
  const { dom, root, state } = fixture('<p>Hello</p>');
  revealChunks(root, state, true);
  root.innerHTML = '<p>Hi</p>';
  revealChunks(root, state, true);
  assert.equal(root.querySelector('.chunk-tail'), null);

  root.innerHTML = '<p>Hi, now complete.</p>';
  revealChunks(root, state, false);
  assert.equal(root.querySelector('.chunk-tail'), null);
  dom.window.close();
});

test('tail fade respects the reduced-motion setting', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.chunk-tail\s*\{[^}]*animation:\s*chunkTailReveal/);
  assert.match(css, /html\[data-motion="off"\] \.chunk-tail\s*\{\s*animation:\s*none;/);
});
