// 历史消息分段只影响界面，不改变发给模型的上下文。
// 按可见用户正文和助手正文的 Unicode 字符数计费，工具参数 / 结果和隐藏消息不计入。
// 一轮从可见用户消息开始，包含其后的所有助手、工具、静默及选项回复消息；
// 单轮即使超过预算也完整保留。导入历史中用户消息之前的可见内容合为一轮。
export const HISTORY_WINDOW_MAX_CHARS = 12288;

const isVisible = (m) => !!m && (m.role === 'user' || m.role === 'assistant') && !m.silent && !m.choiceReply;
const isTurnStart = (m) => isVisible(m) && m.role === 'user';
const bodyChars = (m) => (isVisible(m) && typeof m.text === 'string' ? Array.from(m.text).length : 0);

function historyTurns(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const turns = [];
  let start = 0, chars = 0, visible = false;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (isTurnStart(m) && visible) {
      turns.push({ start, chars });
      start = i; chars = 0; visible = false;
    }
    chars += bodyChars(m);
    visible ||= isVisible(m);
  }
  if (visible) turns.push({ start, chars });
  return turns;
}

/** 历史中可见的完整任务数（无用户消息的导入前缀也算一轮）。 */
export function countHistoryTurns(messages) { return historyTurns(messages).length; }

/** 从末尾按整轮装入预算；最新一轮即使超限也保留。 */
export function historyWindowStart(messages, maxChars = HISTORY_WINDOW_MAX_CHARS) {
  const turns = historyTurns(messages);
  if (!turns.length) return 0;
  const limit = Math.max(1, Number(maxChars) || HISTORY_WINDOW_MAX_CHARS);
  let chars = 0;
  let start = turns[turns.length - 1].start;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (i < turns.length - 1 && chars + turn.chars > limit) break;
    chars += turn.chars;
    start = turn.start;
  }
  return start;
}

/** 返回紧邻当前分段之前的一段的起点；currentStart 必须是已有的整轮切点。 */
export function previousHistoryWindowStart(messages, currentStart, maxChars = HISTORY_WINDOW_MAX_CHARS) {
  const list = Array.isArray(messages) ? messages : [];
  const start = Math.max(0, Math.min(list.length, Number(currentStart) || 0));
  if (!start) return 0;
  return historyWindowStart(list.slice(0, start), maxChars);
}
