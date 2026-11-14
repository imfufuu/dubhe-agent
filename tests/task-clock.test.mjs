// 任务计时暂停：用户确认执行内核警告、完成人机验证期间不计入任务耗时。
// 覆盖：暂停/恢复的叠加语义、读数口径、跨轮清零、打点差值，以及 UI/工具内核的接线契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pauseTaskClock, resumeTaskClock, resetTaskClock, taskClockWaitingMs,
  taskClockPaused, taskClockPauseReason, taskClockMark, taskClockSpan, onTaskClockChange,
} from '../js/task-clock.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

test('暂停期间读数持续增长，恢复后冻结', async () => {
  resetTaskClock();
  assert.equal(taskClockPaused(), false);
  assert.equal(taskClockWaitingMs(), 0);
  pauseTaskClock('confirm');
  assert.equal(taskClockPaused(), true);
  assert.equal(taskClockPauseReason(), 'confirm');
  await nap(30);
  const during = taskClockWaitingMs();
  assert.ok(during >= 25, `暂停期间应累计等待时长，实际 ${during}`);
  resumeTaskClock('confirm');
  const frozen = taskClockWaitingMs();
  await nap(20);
  assert.equal(taskClockWaitingMs(), frozen, '恢复后等待时长不再增长');
  pauseTaskClock('confirm');
  await nap(10);
  resumeTaskClock('confirm');
  assert.ok(taskClockWaitingMs() > frozen, '第二次确认继续累加');
  resetTaskClock();
});

test('多原因叠加：全部恢复后才停止计时，恢复未知原因不报错', () => {
  resetTaskClock();
  pauseTaskClock('confirm');
  pauseTaskClock('human');
  resumeTaskClock('confirm');
  assert.equal(taskClockPaused(), true, '人机验证仍在进行，保持暂停');
  resumeTaskClock('confirm'); // 重复恢复是幂等的
  assert.equal(taskClockPaused(), true);
  resumeTaskClock('human');
  assert.equal(taskClockPaused(), false);
  resumeTaskClock('never-paused');
  assert.equal(taskClockWaitingMs() >= 0, true);
});

test('打点差值 = 这段区间里被暂停掉的时间', async () => {
  resetTaskClock();
  const mark = taskClockMark();
  await nap(10);
  pauseTaskClock('confirm');
  await nap(30);
  resumeTaskClock('confirm');
  const span = taskClockSpan(mark);
  assert.ok(span >= 25, `区间内应记录约 30ms 的等待，实际 ${span}`);
  assert.equal(taskClockSpan(mark, mark), 0);
});

test('resetTaskClock 清掉进行中的暂停，避免跨轮遗留', () => {
  pauseTaskClock('confirm');
  assert.equal(taskClockPaused(), true);
  resetTaskClock();
  assert.equal(taskClockPaused(), false);
  assert.equal(taskClockWaitingMs(), 0);
});

test('订阅者在暂停/恢复/清零时被通知，取消订阅后不再通知', () => {
  resetTaskClock();
  const seen = [];
  const off = onTaskClockChange((reason) => seen.push(reason));
  pauseTaskClock('confirm');
  resumeTaskClock('confirm');
  resetTaskClock();
  off();
  pauseTaskClock('human');
  resumeTaskClock('human');
  // 暂停时带原因，恢复/清零时原因为空
  assert.deepEqual(seen, ['confirm', '', '']);
});

test('接线契约：状态栏扣除等待、工具耗时扣除等待、确认与人机验证处成对暂停恢复', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /from '\.\/task-clock\.js'/, 'ui.js 应引入任务计时');
  assert.match(ui, /performance\.now\(\) - busySince - \(taskClockWaitingMs\(\) - busyWaitMark\)/, '状态栏耗时必须扣掉暂停时间');
  assert.match(ui, /resetTaskClock\(\); busySince = performance\.now\(\); busyWaitMark = taskClockMark\(\)/, '进入 busy 时清零计时');
  assert.match(ui, /pauseTaskClock\('confirm'\)/, '确认卡出现即暂停');
  assert.ok((ui.match(/resumeTaskClock\('confirm'\)/g) || []).length >= 3, '允许、拒绝、回合结束都要恢复计时');
  assert.match(ui, /taskClockPauseReason\(\) === 'human'/, '人机验证期间状态栏如实显示');

  const runner = read('js/toolrunner.js');
  assert.match(runner, /import \{ taskClockMark, taskClockSpan \} from '\.\/task-clock\.js'/);
  assert.match(runner, /call\.durationMs = Math\.max\(1, Date\.now\(\) - t0 - taskClockSpan\(waitMark\)\)/, '工具耗时扣除等待');
  assert.match(runner, /call\.durationMs \?\?= Math\.max\(1, Date\.now\(\) - started - taskClockSpan\(startedMark\)\)/);

  const human = read('js/human-check.js');
  assert.match(human, /pauseTaskClock\(PAUSE_REASON\)/, '弹出验证即暂停');
  assert.match(human, /resumeTaskClock\(PAUSE_REASON\)/, '关闭验证即恢复');
  assert.match(human, /const PAUSE_REASON = 'human'/);
});

test('Turnstile 错误码给出可照做的原因（300010 不再是裸数字）', async () => {
  const { turnstileErrorHint } = await import('../js/human-check.js');
  const widget = turnstileErrorHint('300010');
  assert.match(widget, /300010/);
  assert.match(widget, /初始化|initialize/);
  assert.match(widget, /扩展|extension/);
  assert.match(turnstileErrorHint('110200'), /Hostname Management/);
  assert.match(turnstileErrorHint('100010'), /sitekey|站点密钥/);
  assert.match(turnstileErrorHint('600010'), /网络|network/);
  assert.match(turnstileErrorHint(''), /重试|retry/);
});

test('widget 建不起来时自动退避重试，再失败才交给用户；脚本就绪前不 render', () => {
  const human = read('js/human-check.js');
  assert.match(human, /RENDER_RETRY_DELAYS_MS = \[400, 1200\]/);
  assert.match(human, /\/\^\[36\]00\//, '300/600 段错误进入自动重试');
  assert.match(human, /onload=__dubheTurnstileReady/, '脚本带 onload 回调，避免过早 render 得到 300010');
  assert.match(human, /api\.ready/, '等待 Turnstile 就绪');
  assert.match(human, /box\.style\.minHeight = '65px'/, '零尺寸容器也会导致建不起来');
  assert.match(human, /human-check-retry/, '失败时提供重新验证按钮');
});
