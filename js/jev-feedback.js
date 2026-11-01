// ─── Jev 决策反馈（第 2 / 5 项）：回合结果回写到触发它的用户消息，并取出上一轮给下一轮用 ───
// 只做「读上一条用户消息」与「合并 outcome」，不碰网络；agent.js 只做一行调用，避免其体积超限。
import { mergeJevOutcome } from './jev.js';

/** 把一轮的真实结果（usedTools / regenerated / stopped）记到触发它的用户消息的 jev.outcome 上。 */
export function markJevOutcome(store, userId, patch) {
  if (!userId) return;
  const m = store.state.messages.find((x) => x.id === userId);
  if (m) store.updateMessage(userId, { jev: mergeJevOutcome(m.jev, patch) });
}

/** 当前回合的用户消息 id，以及上一轮（取它的原文、决策摘要与结果）。 */
export function turnContext(messages = []) {
  const users = messages.filter((m) => m.role === 'user');
  const cur = users[users.length - 1] || null;
  const prev = users.length > 1 ? users[users.length - 2] : null;
  return {
    currentId: cur ? cur.id : null,
    previous: prev ? { text: prev.text, summary: prev.jev && prev.jev.summary, outcome: prev.jev && prev.jev.outcome } : null,
  };
}

/** 把结果记到最近一条用户消息上（重新生成时用：触发者就是最近的用户消息）。 */
export function markLastUserOutcome(store, patch) {
  const u = [...store.state.messages].reverse().find((m) => m.role === 'user');
  if (u) markJevOutcome(store, u.id, patch);
}
