export const OFFLINE_INPUT_CAP = 7168; // n_ctx 8192 − 输出预留 1024
// 本地 GGUF 上下文裁剪：按字符/4 粗估 token，保留 system 与最近的消息，避免超出 n_ctx。
export function estimateTokens(messages) {
  // 保守估算：CJK 约 1 字 1 token，ASCII 约 4 字符 1 token；按 /4 会严重低估中文/代码，
  // 第二轮历史累积后裁剪不足 → "request exceeds the available context size"。
  return (messages || []).reduce((n, m) => {
    const text = String(m?.content ?? '');
    let cjk = 0, ascii = 0;
    for (const ch of text) (ch.codePointAt(0) > 0x2e7f ? cjk++ : ascii++);
    return n + cjk + Math.ceil(ascii / 4) + 4;
  }, 0);
}
export function fitMessagesToContext(messages, budgetTokens = 6144) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!list.length || estimateTokens(list) <= budgetTokens) return list;
  const head = list.filter((m) => m.role === 'system' || m.role === 'developer');
  const rest = list.filter((m) => m.role !== 'system' && m.role !== 'developer');
  // 输出预留：输入预算不超过 n_ctx - 1024，且估算已是保守口径。
  let budget = Math.min(Math.max(256, Number(budgetTokens) || 6144), OFFLINE_INPUT_CAP) - estimateTokens(head);
  const kept = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens([rest[i]]);
    if (cost > budget && kept.length) break;
    budget -= cost; kept.unshift(rest[i]);
    if (budget <= 0) break;
  }
  return [...head, ...kept];
}
