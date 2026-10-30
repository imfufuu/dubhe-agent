// Presentation order is persisted independently of protocol text/toolCalls.
// No tool/result message may move across visible assistant text or another tool family.
export function recordOutputText(message, start, end) {
  if (end <= start) return;
  const order = message.outputOrder || (message.outputOrder = []);
  const last = order[order.length - 1];
  if (last?.kind === 'text' && last.end === start) last.end = end;
  else order.push({ kind: 'text', start, end });
}
export function recordOutputTool(message, index) {
  const order = message.outputOrder || (message.outputOrder = []);
  if (order.some((p) => p.kind === 'tools' && p.indices.includes(index))) return;
  const last = order[order.length - 1];
  if (last?.kind === 'tools') last.indices.push(index);
  else order.push({ kind: 'tools', indices: [index] });
}
// 联网检索 / 网页抓取 / 生成类工具：与 Explored File(s) 相同，合并为一个可展开的折叠行（不再散落为命令芯片）。
export const WEB_TOOL_NAMES = new Set(['search_web', 'fetch_url', 'generate_image', 'generate_video']);
export function toolFamily(call) {
  if (call?.name === 'write_file') return 'edited';
  // 任务清单不进命令菜单：由消息内的清单卡片实时展示（ui-toolflow.js syncChecklistBlock）
  if (call?.name === 'checklist') return 'checklist';
  if (WEB_TOOL_NAMES.has(call?.name)) return 'web';
  // 2026.10.21：知识库检索是独立消息块（进行中显示检索词的抛光行，完成后收起且不可展开），
  // 不再混进 Ran command 命令菜单。
  if (call?.name === 'knowledge_search') return 'knowledge';
  if (['read_file', 'analyze_image', 'analyze_pdf', 'analyze_svg', 'analyze_video', 'analyze_audio'].includes(call?.name)) return 'explored';
  return 'commands';
}
export function displayParts(message) {
  const text = String(message?.text || '');
  const calls = Array.isArray(message?.toolCalls) ? message.toolCalls : [];
  const indexOrder = message?.toolOrderIndices || calls.map((_, i) => i);
  const byIndex = new Map(indexOrder.map((index, i) => [index, calls[i]]));
  const validOrder = Array.isArray(message?.outputOrder) && message.outputOrder.every((p) => p && (p.kind === 'text' && Number.isFinite(p.start) && Number.isFinite(p.end) || p.kind === 'tools' && Array.isArray(p.indices)));
  const order = validOrder && message.outputOrder.length ? message.outputOrder : [
    ...(text ? [{ kind: 'text', start: 0, end: text.length }] : []),
    ...(calls.length ? [{ kind: 'tools', indices: indexOrder }] : []),
  ];
  const result = [];
  const used = new Set();
  const addCall = (call) => {
    if (!call || used.has(call)) return;
    used.add(call);
    const family = toolFamily(call);
    const last = result[result.length - 1];
    if (last?.kind === family) last.toolCalls.push(call);
    else result.push({ kind: family, text: '', toolCalls: [call] });
  };
  for (const part of order) {
    if (part.kind === 'text') {
      const value = text.slice(part.start, part.end);
      if (value) result.push({ kind: 'text', text: value, toolCalls: [] });
    } else if (part.kind === 'tools') part.indices.forEach((index) => addCall(byIndex.get(index)));
  }
  calls.forEach(addCall); // imported/legacy messages without complete order metadata
  return result;
}
export function turnHasAssistantText(messages, id) {
  const at = messages.findIndex((m) => m.id === id);
  if (at < 0) return false;
  let lo = at, hi = at;
  while (lo > 0 && messages[lo - 1].role !== 'user') lo--;
  while (hi + 1 < messages.length && messages[hi + 1].role !== 'user') hi++;
  return messages.slice(lo, hi + 1).some((m) => m.role === 'assistant' && String(m.text || m.publicPlan?.direction || '').trim());
}
// Only adjacent, text-free tool-only assistant messages are eligible for merging.
export function adjacentToolMessages(messages, id, predicate) {
  const at = messages.findIndex((m) => m.id === id);
  if (at < 0) return [];
  const eligible = (m) => m?.role === 'assistant' && !m.publicPlan?.direction && !String(m.text || '').trim()
    && m.toolCalls?.length && m.toolCalls.every(predicate);
  if (!eligible(messages[at])) return [messages[at]];
  const cluster = [messages[at]];
  for (const step of [-1, 1]) {
    for (let i = at + step; i >= 0 && i < messages.length; i += step) {
      const m = messages[i];
      if (m.role === 'tool') continue;
      if (!eligible(m)) break;
      if (step < 0) cluster.unshift(m); else cluster.push(m);
    }
  }
  return cluster;
}
// Turn-level "Ran command" runs: separate but consecutive command blocks render as ONE block.
// Command parts merge across assistant-message boundaries only while nothing visible sits
// between them — assistant text, Edited/Explored folds, a public plan, a visible reasoning fold,
// an error / cancel / empty-reply tail all stay barriers (no output ever moves across them).
// The run is painted by its LAST segment; earlier segments render empty.
export function commandRunFor(messages, id, partIndex = 0, { reasoningVisible = () => false, partsOf = displayParts } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const at = list.findIndex((m) => m.id === id);
  if (at < 0) return null;
  const turnUser = (m) => m.role === 'user' && !m.silent;
  let lo = at, hi = at;
  while (lo > 0 && !turnUser(list[lo - 1])) lo--;
  while (hi + 1 < list.length && !turnUser(list[hi + 1])) hi++;
  const runs = [];
  let cur = null;
  for (let i = lo; i <= hi; i++) {
    const msg = list[i];
    if (msg.role !== 'assistant') continue;
    const hasVisibleBarrier = !!(msg.publicPlan?.direction || reasoningVisible(msg));
    if (hasVisibleBarrier) cur = null;
    const parts = partsOf(msg);
    parts.forEach((part, index) => {
      if (part.kind === 'commands' && part.toolCalls.length) {
        if (!cur) { cur = { segments: [], calls: [] }; runs.push(cur); }
        cur.segments.push({ id: msg.id, part: index });
        cur.calls.push(...part.toolCalls);
      } else if (part.kind !== 'text' || String(part.text || '').trim()) cur = null;
    });
    const emptyReply = msg.done && !parts.length && !msg.cancelled;
    // A thought/plan attached to this message is also a boundary after its command block.
    // Keep persisted reasoning surfaces from allowing earlier tool chips to migrate into
    // the next message's command fold during a full-session repaint.
    if (hasVisibleBarrier || msg.error || msg.cancelled || msg.webSearch || emptyReply) cur = null;
  }
  const run = runs.find((r) => r.segments.some((s) => s.id === id && s.part === partIndex));
  if (!run) return null;
  const host = run.segments[run.segments.length - 1];
  return { segments: run.segments, calls: run.calls, host, isHost: host.id === id && host.part === partIndex };
}
export const TOOL_STREAM_MAX_CHARS = 65536;
export function appendToolStream(call, { stream, delta, reset } = {}) {
  if (!call || !['stdout', 'stderr', 'thinking'].includes(stream)) return;
  const output = call.liveOutput || (call.liveOutput = { stdout: '', stderr: '' });
  output[stream] = ((reset ? '' : output[stream] || '') + String(delta || '')).slice(-TOOL_STREAM_MAX_CHARS);
}
