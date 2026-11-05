// 历史消息分段（界面「更早的消息」折叠接缝）：按正文字数分段，每个折叠分区不超过 HISTORY_WINDOW_MAX_CHARS 字。
// - 字数只统计可见消息（用户 / 助手）的正文 text；工具调用参数与工具结果不计入。
// - 超出的消息顺延到下一段（向下延续）；切点只落在用户 / 助手消息上，不会把工具结果与其调用拆开。
// - 单条消息本身超过上限时自成一段，不做截断；最新一条消息始终完整保留。
// 本模块只影响界面的折叠分段，不改变发给模型的上下文。
export const HISTORY_WINDOW_MAX_CHARS = 4096;

const isVisible = (m) => !!m && (m.role === 'user' || m.role === 'assistant') && !m.silent && !m.choiceReply;
const isCutPoint = (m) => !!m && (m.role === 'user' || m.role === 'assistant');
const codepoints = (s) => Array.from(String(s || '')).length;
const bodyChars = (m) => (isVisible(m) && typeof m.text === 'string' ? codepoints(m.text) : 0);

/** 返回当前分段的起始数组下标（从末尾向前装入，直到加入下一条会超过 maxChars）。 */
export function historyWindowStart(messages, maxChars = HISTORY_WINDOW_MAX_CHARS) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return 0;
  const limit = Math.max(1, Number(maxChars) || HISTORY_WINDOW_MAX_CHARS);
  const last = list.length - 1;
  let chars = 0;
  let start = last;
  for (let i = last; i >= 0; i--) {
    const add = bodyChars(list[i]);
    // 最新一条无条件保留（即使单条超限）；之后的消息超出预算即停在下一个切点。
    if (i < last && chars + add > limit) break;
    chars += add;
    start = i;
  }
  // 切点必须是用户 / 助手消息：若落在工具结果上，向后顺延到下一个切点（被跳过的工具结果属于被裁掉的助手消息）。
  while (start < last && !isCutPoint(list[start])) start += 1;
  return start;
}

/** 返回紧邻当前分段之前的一段的起点；currentStart 必须是 historyWindowStart 给出的切点。 */
export function previousHistoryWindowStart(messages, currentStart, maxChars = HISTORY_WINDOW_MAX_CHARS) {
  const list = Array.isArray(messages) ? messages : [];
  const start = Math.max(0, Math.min(list.length, Number(currentStart) || 0));
  if (!start) return 0;
  return historyWindowStart(list.slice(0, start), maxChars);
}
