// 第 13 条：analyze 类工具可直接传外部 http(s) 链接；下载失败把原因直接回传，不静默。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeTool, TOOL_DEFS } from '../js/tools.js';

const originalFetch = globalThis.fetch;
const fakeFs = () => {
  const files = new Map();
  return {
    files,
    list: () => [...files.keys()].map((path) => ({ path })),
    read: (p) => (files.has(p) ? files.get(p) : null),
    write: (p, c) => files.set(p, c),
    export: () => Object.fromEntries(files),
  };
};

test('analyze tools accept external URLs in their schema', () => {
  for (const name of ['analyze_image', 'analyze_svg', 'analyze_video', 'analyze_audio', 'analyze_pdf']) {
    const def = TOOL_DEFS.find((t) => t.name === name);
    assert.ok(def, `${name} 已注册`);
    assert.match(def.parameters.properties.path.description, /http\(s\)|外部/, `${name} 的 path 说明含外部链接`);
  }
});

test('analyze_pdf with an unreachable external URL returns the download reason, not a silent fallback', async () => {
  globalThis.fetch = async () => { throw new TypeError('network down'); };
  try {
    const fs = fakeFs();
    const out = await executeTool('analyze_pdf', { path: 'https://example.com/report.pdf' }, { fs, apiKey: 'k', onUi: () => {}, signal: undefined });
    assert.match(out, /^analyze_pdf 失败：外部文件下载失败/, out);
    assert.equal(fs.files.size, 0, '下载失败不写入任何文件');
  } finally { globalThis.fetch = originalFetch; }
});

test('analyze tools keep the sandbox path behaviour unchanged for local paths', () => {
  const source = readFileSync(new URL('../js/tools.js', import.meta.url), 'utf8');
  assert.match(source, /if \(ANALYZE_URL_TOOLS\.has\(name\)\) \{\s*const pre = await materializeExternalAnalyzeArgs/);
  assert.match(source, /EXTERNAL_HTTP_RE\.test\(out\.path\.trim\(\)\)/);
});
