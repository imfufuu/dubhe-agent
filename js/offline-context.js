// 本地 GGUF 上下文裁剪：按字符/4 粗估 token，保留 system 与最近的消息，避免超出 n_ctx。
export function estimateTokens(messages) {
  return (messages || []).reduce((n, m) => n + Math.ceil(String(m?.content ?? '').length / 4) + 4, 0);
}
export function fitMessagesToContext(messages, budgetTokens = 6144) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!list.length || estimateTokens(list) <= budgetTokens) return list;
  const head = list.filter((m) => m.role === 'system' || m.role === 'developer');
  const rest = list.filter((m) => m.role !== 'system' && m.role !== 'developer');
  let budget = Math.max(256, Number(budgetTokens) || 6144) - estimateTokens(head);
  const kept = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const cost = estimateTokens([rest[i]]);
    if (cost > budget && kept.length) break;
    budget -= cost; kept.unshift(rest[i]);
    if (budget <= 0) break;
  }
  return [...head, ...kept];
}
