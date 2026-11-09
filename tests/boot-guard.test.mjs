// 加载屏兜底阈值：2026-11-08 由 90s 提高到 120s（弱网 / 首次下载完整西夏文 TTF）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const bootScript = /<script>([\s\S]*?)<\/script>/.exec(app)?.[1] || '';

test('启动屏强制显示的阈值精确为 120000 ms', () => {
  assert.match(app, /var BOOT_TIMEOUT_MS=120000;/);
  assert.doesNotMatch(app, /BOOT_TIMEOUT_MS\s*=\s*90000/);
  assert.doesNotMatch(app, /BOOT_TIMEOUT_MS\s*=\s*(?!120000)\d+/);
  assert.match(bootScript, /setTimeout\(function\(\)\{ forceReveal\(/, '超时回调必须仍用同一常量');
  assert.match(bootScript, /\},BOOT_TIMEOUT_MS\);/);
});

test('注释、慢网等待说明与强制显示文案同步为 120 秒', () => {
  assert.match(app, /120 秒仍未挂载时才判失败/);
  assert.match(app, /两个按钮只在 120 秒超时/);
  assert.match(app, /forceReveal\('启动超过 120 秒仍未完成/);
  assert.doesNotMatch(app, /90 秒/);
  assert.doesNotMatch(app, /启动超过 90 秒/);
});
