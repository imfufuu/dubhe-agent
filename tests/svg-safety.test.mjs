import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSvgText,
  sanitizeSvgMarkup,
  svgDataUrl,
  svgSourceFromValue,
} from '../js/svg-safety.js';

const unsafeSvg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" onload="steal()">
  <script>steal()</script>
  <foreignObject><iframe src="https://bad.invalid/">x</iframe></foreignObject>
  <a href="https://bad.invalid/" onclick="steal()"><text>Hello &amp; 世界</text></a>
  <image href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=" />
  <style>@import url(https://bad.invalid/a.css); .bad { fill: url(https://bad.invalid/a.svg#x) } .ok { fill: url(#gradient) }</style>
</svg>`;

test('SVG sanitizer removes active content, handlers, external references and dangerous CSS', () => {
  const safe = sanitizeSvgMarkup(unsafeSvg);
  assert.match(safe, /<svg\b/);
  assert.doesNotMatch(safe, /<script\b|<foreignObject\b|<iframe\b/i);
  assert.doesNotMatch(safe, /onload\s*=|onclick\s*=/i);
  assert.doesNotMatch(safe, /href\s*=\s*["']https?:/i);
  assert.doesNotMatch(safe, /@import|url\(https?:/i);
  assert.match(safe, /url\(#gradient\)/);
  assert.match(safe, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('SVG OCR extracts native title, desc, and text, decoding XML entities', () => {
  assert.equal(extractSvgText(unsafeSvg), 'Hello & 世界');
  assert.equal(extractSvgText('<svg><title>Chart &amp; legend</title><desc>Two axes</desc><text>A &lt; B</text></svg>'), 'Chart & legend\nTwo axes\nA < B');
});

test('SVG data URL supports percent-encoded and base64 UTF-8 sources', () => {
  const encoded = svgDataUrl(unsafeSvg);
  assert.match(encoded, /^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(svgSourceFromValue(encoded), /世界/);
  assert.doesNotMatch(svgSourceFromValue(encoded), /<script\b/i);

  const base64 = `data:image/svg+xml;base64,${Buffer.from(unsafeSvg, 'utf8').toString('base64')}`;
  assert.match(svgSourceFromValue(base64), /世界/);
  assert.doesNotMatch(sanitizeSvgMarkup(base64), /<script\b/i);
});

test('rejects malformed roots, doctypes, custom entities, and oversized SVG input', () => {
  assert.throws(() => sanitizeSvgMarkup('<!-- <svg>fake</svg> --><html><svg></svg></html>'), /根元素/);
  assert.throws(() => sanitizeSvgMarkup('<svg><g></svg>'), /解析失败|未闭合|未配对/);
  assert.throws(() => sanitizeSvgMarkup('<!DOCTYPE svg [<!ENTITY x "boom">]><svg/>'), /DOCTYPE|自定义实体/);
  assert.throws(() => sanitizeSvgMarkup('<svg/>', { maxChars: 3 }), /安全限制/);
});
