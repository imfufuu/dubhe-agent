// 长图 / 离线 HTML 导出：完成后自动下载（不做「共享」），并有分块进度条。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ui = read('js/ui-share.js');
const capture = read('js/share-capture.js');

test('export never goes through the system share sheet', () => {
  assert.doesNotMatch(ui, /navigator\.share\b/, '不再调用 navigator.share');
  assert.doesNotMatch(ui, /shareOrFallback|系统分享面板/, '旧的共享分支已移除');
});

test('finished exports are delivered by automatic browser download', () => {
  assert.match(ui, /async function deliverFile\(blob, filename\)\s*\{\s*if \(!DOWNLOAD_UNSUPPORTED && tryDownload\(blob, filename\)\) return 'downloaded';/);
  for (const name of ['name + \'.html\'', 'name + \'.png\'', 'name + \'-images.zip\'']) {
    assert.ok(ui.includes(`deliverFile(`) && ui.includes(name), `${name} 走 deliverFile`);
  }
  assert.match(ui, /自动下载|automatically/);
});

test('export shows a progress bar driven by capture stages and parts', () => {
  assert.match(ui, /setProgress\(0\.05\)/, '开始即显示进度');
  assert.match(ui, /onPart: \(done, total\) => setProgress\(0\.3 \+ 0\.65/, '分块完成推进进度');
  assert.match(ui, /finally \{ exporting = false; setProgress\(null\);/, '结束后隐藏进度条');
  assert.match(ui, /role', 'progressbar'/);
});

test('captureShare reports the planned part count before rendering', () => {
  assert.match(capture, /const plan = capturePlan\([^)]*\); const parts = \[\];\s*onStage\?\.\('plan', plan\.length\);/);
});
