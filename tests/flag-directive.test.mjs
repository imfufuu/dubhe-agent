import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { flagMarkup, flagSequence, puaCodeFor } from '../js/flag-directive.js';
import { regionalFlags, subdivisionFlags, puaFlags } from '../js/flag-registry.js';
import { selectLazyFaces, codepointsOf } from '../js/lazy-fonts.js';

const sandbox = {}; sandbox.self = sandbox; sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(new URL('../assets/md/markdown-it.min.js', import.meta.url), 'utf8'), sandbox);
globalThis.markdownit = sandbox.markdownit;
const { renderMarkdown: markdown } = await import('../js/ui-markdown.js?flagtest=full');
globalThis.markdownit = undefined;
const { renderMarkdown: fallback } = await import('../js/ui-markdown.js?flagtest=fallback');
fallback('warm up'); globalThis.markdownit = sandbox.markdownit; markdown('warm up');
const cps = text => [...text].map(ch => ch.codePointAt(0));
const seq = id => flagSequence(id)?.value;

test('all supported regional codes emit stable single-codepoint PUA glyphs', () => {
  assert.equal(regionalFlags.size, 187);
  // 2026-11-09：默认改用 BabelStone Flags PUA；官网建议用它规避 emoji 字体回退与
  // GSUB ccmp 序列合成，切换标签页后不会整批隐身。4 个伪代码没有 PUA 映射，保留 RI 序列。
  const fallbackToSequence = new Set(['xe', 'xn', 'xs', 'xw']);
  for (const id of regionalFlags) {
    if (fallbackToSequence.has(id)) {
      assert.deepEqual(cps(seq(id)), [...id].map(c => 0x1f1e6 + c.charCodeAt(0) - 97), id);
      assert.equal(flagSequence(id).puaFont, false);
      continue;
    }
    assert.deepEqual(cps(seq(id)), [parseInt(puaFlags[id], 16)], id);
    assert.equal(flagSequence(id).puaFont, true, id);
    assert.equal(seq(id), puaCodeFor(id), id);
  }
  assert.equal(seq('USSR'), seq('su'));
  for (const id of ['us', 'su', 'eu', 'un', 'aq', 'cs', 'dd', 'yu', 'cq']) assert.ok(seq(id), id);
});

test('all supported subdivision codes emit stable PUA glyphs with aliases normalized', () => {
  assert.equal(subdivisionFlags.size, 87);
  for (const id of subdivisionFlags) {
    assert.equal(flagSequence(id).puaFont, true, id);
    const points = cps(seq(id));
    assert.equal(points.length, 1, `${id} 应为单码位字形`);
    assert.ok(points[0] >= 0xe000 && points[0] <= 0xe43f, id);
  }
  assert.equal(seq('gb-cym'), seq('gb-wls'));
  assert.equal(seq('nl-bq1'), seq('bq-bo'));
  assert.ok(seq('gb-xbr')); assert.ok(seq('iq-kr'));
});

test('the five documented ZWJ flags use the correct sequences', () => {
  const samples = {
    rainbow: [0x1f3f3, 0xfe0f, 0x200d, 0x1f308],
    transgender: [0x1f3f3, 0xfe0f, 0x200d, 0x26a7, 0xfe0f],
    pirate: [0x1f3f4, 0x200d, 0x2620, 0xfe0f],
    aboriginal: [0x1f3f4, 0x200d, 0x1f998],
    'refugee-nation': [0x1f3f3, 0x200d, 0x1f7e7, 0x200d, 0x2b1b, 0x200d, 0x1f7e7],
  };
  for (const [id, expected] of Object.entries(samples)) assert.deepEqual(cps(seq(id)), expected, id);
});

test('all four ordinary PUA designs and all 263 PUA-face mappings work', () => {
  for (const [id, code] of Object.entries({ 'mr-old': 0xf000, 'hn-old': 0xf001, 'sy-old': 0xf002, 'de-by-alt': 0xf400 })) {
    assert.deepEqual(cps(seq(id)), [code]); assert.equal(flagSequence(id).puaFont, false);
    assert.deepEqual(cps(seq(`pua-${code.toString(16)}`)), [code]);
  }
  assert.equal(Object.keys(puaFlags).length, 263);
  for (const [id, hex] of Object.entries(puaFlags)) {
    assert.deepEqual(cps(seq(`pua-${id}`)), [parseInt(hex, 16)], id);
    assert.equal(flagSequence(`pua-${id}`).puaFont, true);
    assert.equal(seq(`pua-${hex}`), seq(`pua-${id}`));
  }
  assert.equal(seq('pua-gb-cym'), seq('pua-gb-wls'));
  assert.equal(seq('pua-us-pr'), seq('pua-pr'));
  assert.equal(seq('pua-rainbow'), seq('pua-rainbow-flag'));
});

test('unsupported or invalid flags are never mislabeled as another design', () => {
  for (const id of ['ai', 'pua-ai', 'pua-e008', 'pua-e000', 'nato', 'hre', 'prussia', 'ru-empire', 'true-south', 'constructor', '../us']) {
    assert.equal(flagSequence(id), null, id);
    for (const render of [markdown, fallback]) assert.doesNotMatch(render(`::flag[${id}]::`), /class="md-flag/);
  }
});

test('both renderers output accessible isolated Unicode spans, not images', () => {
  for (const render of [markdown, fallback]) {
    const html = render('::flag[ussr|苏联]::::flag[us|美国]:: ::flag[pua-us|美国 PUA]::');
    assert.equal((html.match(/role="img"/g) || []).length, 3);
    assert.match(html, /aria-label="苏联"/); assert.match(html, /aria-label="美国"/);
    assert.match(html, /md-flag-pua/); assert.doesNotMatch(html, /<img/);
  }
});

test('code, escapes, table cells and link destinations retain their semantics', () => {
  for (const render of [markdown, fallback]) {
    const html = render('`::flag[us]::`\n\n```text\n::flag[eu]::\n```\n\n\\::flag[un]::');
    assert.doesNotMatch(html, /class="md-flag/);
    for (const id of ['us', 'eu', 'un']) assert.ok(html.includes(`::flag[${id}]::`));
    assert.doesNotMatch(render('    ::flag[us|Test]::'), /class="md-flag/);
    assert.doesNotMatch(render('[link](https://example.test/::flag[us]::)'), /class="md-flag/);
  }
  for (const source of ['| flag | note |\n|---|---|\n| ::flag[us|Name]:: | yes |', 'flag | note\n--- | ---\n::flag[us|Name]:: | yes']) {
    const html = markdown(source); assert.equal((html.match(/<td>/g) || []).length, 2); assert.match(html, /aria-label="Name"/);
  }
  assert.equal((markdown('::flag[us]::::flag[eu]::').match(/class="md-flag/g) || []).length, 2);
});

test('labels are escaped and placeholders cannot introduce HTML into attributes', () => {
  const match = flagMarkup('::flag[us|" onerror="alert(1) & unsafe]::');
  assert.match(match.html, /aria-label="&quot; onerror=&quot;alert\(1\) &amp; unsafe"/);
  assert.doesNotMatch(match.html, /\sonerror="/);
  for (const render of [markdown, fallback]) {
    const html = render('::flag[us|bad <img src=x onerror="alert(1)">]::');
    assert.doesNotMatch(html, /class="md-flag/); assert.doesNotMatch(html, /onerror=/);
  }
});

test('pinned 4.13 fonts and Unicode ranges include PUA and every ZWJ component', () => {
  const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url));
  const hash = p => createHash('sha256').update(read(p)).digest('hex');
  assert.equal(hash('assets/fonts-lazy/babelstone/flags.woff2'), '5f2da43ce8c83dda3c09ce255adef14f51f44925e881b8b6d8d00017de8d7756');
  assert.equal(hash('assets/fonts-lazy/babelstone/flags-pua.ttf'), '1ff6d8c9234612b465354e0f42c46196ab83f6b16f617ff6dce3e0999aa2f63a');
  const css = read('assets/fonts-lazy/index.css').toString();
  const faces = selectLazyFaces(css, codepointsOf('🏳️‍⚧️🏴‍🦘🏳‍🟧‍⬛‍🟧\uf000\ue21a'));
  assert.ok(faces.some(f => f.url.endsWith('/flags.woff2')));
  assert.ok(faces.some(f => f.url.endsWith('/flags-pua.ttf')));
  const flagFace = faces.find(f => f.url.endsWith('/flags.woff2'));
  for (const cp of cps('🏳️‍⚧️🏴‍🦘🏳‍🟧‍⬛‍🟧\uf000')) assert.ok(flagFace.ranges.some(([lo, hi]) => cp >= lo && cp <= hi), cp.toString(16));
});

test('offline HTML export embeds both fonts and preserves Unicode sequences', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'file:///home/user/dubhe-agent/app.html' });
  const names = ['document', 'location', 'DOMParser', 'XMLSerializer', 'FileReader', 'fetch'];
  const previous = Object.fromEntries(names.map(n => [n, globalThis[n]]));
  Object.assign(globalThis, { document: dom.window.document, location: dom.window.location, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });
  globalThis.FileReader = class { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }, err => { this.error = err; this.onerror(); }); } };
  globalThis.fetch = async input => { try { const url = new URL(input); return new Response(fs.readFileSync(fileURLToPath(url))); } catch { return new Response('', { status: 404 }); } };
  try {
    const { buildShareDocument } = await import('../js/share-document.js');
    const msg = { id: 'flags', role: 'assistant', text: '::flag[rainbow|彩虹]:: ::flag[sy-old|旧旗]:: ::flag[pua-us|美国]::' };
    const html = await buildShareDocument({ messages: [msg], selected: [msg], fs: { read: () => null }, interactive: false });
    const output = new JSDOM(html).window.document;
    const flags = output.querySelectorAll('.md-flag');
    assert.equal(flags.length, 3);
    assert.equal(flags[0].textContent, seq('rainbow')); assert.equal(flags[1].textContent, seq('sy-old')); assert.equal(flags[2].textContent, seq('pua-us'));
    assert.match(html, /font-family: "BabelStone Flags"[^}]*url\(data:font\/woff2;base64,/);
    assert.match(html, /font-family: "BabelStone Flags PUA"[^}]*url\(data:font\/ttf;base64,/);
  } finally { for (const name of names) globalThis[name] = previous[name]; dom.window.close(); }
});
