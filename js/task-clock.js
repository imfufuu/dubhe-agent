// 任务计时（可暂停）。等待用户决定（执行内核的高风险确认）和等待人机验证（Turnstile）都属于
// 「人在打字/在点验证」，不该算进任务耗时。状态栏耗时、工具 durationMs、回合统计共用这一份口径，
// 避免出现「状态栏停了、工具卡片还在涨」这种自相矛盾的数字。
//
// 用法：pauseTaskClock('confirm') / resumeTaskClock('confirm') 成对出现；读取只走 taskClockWaitingMs()。
const reasons = new Set();
let pausedSince = 0;
let waitedMs = 0;
const listeners = new Set();

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/** 从最近一次 resetTaskClock() 起累计的「暂停总时长」，包含当前仍在进行中的暂停。 */
export function taskClockWaitingMs() {
  return waitedMs + (reasons.size ? now() - pausedSince : 0);
}

export function taskClockPaused() {
  return reasons.size > 0;
}

/** 当前暂停原因（给状态栏写「等待确认 / 等待人机验证」用），无暂停返回 ''。 */
export function taskClockPauseReason() {
  return reasons.size ? [...reasons][0] : '';
}

export function pauseTaskClock(reason = 'manual') {
  if (reasons.has(reason)) return;
  if (!reasons.size) pausedSince = now();
  reasons.add(reason);
  emit();
}

export function resumeTaskClock(reason = 'manual') {
  if (!reasons.delete(reason)) return;
  if (!reasons.size) {
    waitedMs += now() - pausedSince;
    pausedSince = 0;
  }
  emit();
}

/** 新一轮任务开始（状态栏进入 busy）时清零；进行中的暂停原因一并清掉，避免跨轮遗留。 */
export function resetTaskClock() {
  reasons.clear();
  pausedSince = 0;
  waitedMs = 0;
  emit();
}

/** 打点：记录某个时刻的累计暂停值，之后用 taskClockSpan(mark) 得到这段里被暂停掉的时间。 */
export function taskClockMark() {
  return taskClockWaitingMs();
}

export function taskClockSpan(mark, nowMs = taskClockWaitingMs()) {
  return Math.max(0, nowMs - (Number(mark) || 0));
}

/** 暂停/恢复/清零时通知界面立即重绘，不必等下一次 ticker。 */
export function onTaskClockChange(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of [...listeners]) {
    try { fn(taskClockPauseReason()); } catch { /* 监听方出错不影响计时 */ }
  }
}
