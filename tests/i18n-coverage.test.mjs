// 防漏翻回归：界面模块不得再出现写死的中文，并锁定各页面的已知缺口上限（只降不升）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const run = () => JSON.parse(execFileSync(process.execPath, [new URL('../tools/i18n-coverage.mjs', import.meta.url).pathname, '--json'], { encoding: 'utf8' }));

test('界面模块（ui / settings / 预览 / 附件 / 人机验证 …）0 条写死中文', () => {
  const data = run();
  assert.equal(data.strict, 0, `仍有写死中文：${JSON.stringify((data.byFile && Object.entries(data.byFile).filter(([f]) => f.endsWith('.js'))).slice(0, 3))}`);
});

test('页面缺口只降不升：docs.html ≤ 371、index.html ≤ 9', () => {
  const { byFile } = run();
  const docs = (byFile['docs.html'] || []).length;
  const home = (byFile['index.html'] || []).length;
  assert.ok(docs <= 371, `docs.html 未翻译条目从 371 涨到 ${docs}`);
  assert.ok(home <= 9, `index.html 未翻译条目从 9 涨到 ${home}`);
});

test('语言自身名称与拼接片段不误报（中文 / 日本語 / 한국어 按各自语言显示）', () => {
  const { byFile } = run();
  const texts = Object.values(byFile).flat().map((f) => f.text);
  for (const native of ['中文', '日本語', '한국어']) assert.equal(texts.includes(native), false, `${native} 属于原生语言名，不应报漏翻`);
});

test('scripts/i18n-audit.mjs 仍然零发现（只覆盖 app.html 与 ui* 的旧口径）', () => {
  const out = execFileSync(process.execPath, [new URL('../scripts/i18n-audit.mjs', import.meta.url).pathname, '--json'], { encoding: 'utf8' }).trim();
  assert.deepEqual(JSON.parse(out || '[]'), []);
});
