// 界面草稿与纯展示辅助（从 ui.js 外移，保持 ui.js 在 3000 行以内）。

// 思考原文按 Markdown 渲染，但形似 HTML 标签的内容（如 <step>）包成行内代码，原样作为文字显示，不能被当成标签吞掉。
export function reasoningMarkdownSource(value) {
  return String(value ?? '').replace(/<(\/?[A-Za-z][\w-]*(?:\s[^<>`]*)?\/?>)/g, (tag) => (tag.includes('`') ? tag : '`' + tag + '`'));
}

// 本地模型在消息头 / 连接提示里统一显示：用户设定的模型名（不显示内部 ID local/gguf）
export function localModelLabel(store, fallback) {
  return String(store?.state?.offlineModelMetadata?.displayName || fallback).slice(0, 160);
}

// 未保存的 Key / 暗号草稿：与已保存的 Key 相同则不算草稿（核对成功后自动清空）
export function keyDraftFrom(keyValue, phraseValue, savedKey) {
  const typed = String(keyValue || '').trim();
  return typed && typed !== (savedKey || '') ? { key: String(keyValue), phrase: String(phraseValue || '') } : null;
}

// API Key 核对完成后放回被拦下的原文；输入框已被用户改动时不覆盖。返回应写入的文本或 null。
export function restorableComposerText(currentValue, draft) {
  if (!draft || String(currentValue || '').trim()) return null;
  return draft;
}

// 最后一条用户消息之后若没有任何助手答复（无正文、无思考、无工具调用），返回该用户消息（id/text）；否则 null。
export function unansweredUserTurn(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const at = list.findLastIndex((m) => m && m.role === 'user');
  if (at < 0) return null;
  const replied = list.slice(at + 1).some((m) => m && m.role === 'assistant'
    && (String(m.text || '').trim() || String(m.reasoning || '').trim() || (m.toolCalls && m.toolCalls.length)));
  return replied || typeof list[at].id === 'undefined' ? null : { id: list[at].id, text: String(list[at].text || '') };
}

// 「本轮回复」纯文本：上一条用户消息之后的全部非临时助手消息，按时间顺序拼接。
// 每段取已渲染 DOM 的 innerText，表格/代码/列表保留排版；DOM 缺失时回退到原始文本。
export function turnPlainText(store, m, wrap) {
  if (m.role === 'user') return String(wrap?.querySelector('.bubble')?.innerText || m.text || '');
  const all = store.state.messages;
  const at = all.findIndex((x) => x.id === m.id);
  const userAt = all.slice(0, Math.max(at, 0)).findLastIndex((x) => x.role === 'user');
  const turn = at < 0 ? [m] : all.slice(userAt + 1, at + 1).filter((x) => x.role === 'assistant' && !x.transientModeration);
  const container = wrap?.parentElement;
  const parts = turn.map((x) => {
    const message = [...(container?.querySelectorAll('.msg[data-id]') || [])].find(n => n.dataset.id === String(x.id));
    const bodies = message?.querySelectorAll(':scope > .md-body, :scope > .assistant-flow > .assistant-fragment > .md-body');
    const visible = [...(bodies || [])].map(node => node.innerText || '').filter(Boolean).join('\n\n');
    return String(visible || x.text || '').replace(/\n{3,}/g, '\n\n').trim();
  }).filter(Boolean);
  if (parts.length) return parts.join('\n\n');
  return String(wrap?.querySelector(':scope > .md-body')?.innerText || m.text || '');
}

export function installComposerDraft(store, composer, onLoad = () => {}) {
  const session = () => (store.state.sessions || []).find(s => s.id === store.state.activeSessionId);
  const save = (immediate = false) => { const current = session(); if (current) current.composerDraft = composer.value; store.save?.(immediate); };
  const load = () => { composer.value = String(session()?.composerDraft || ''); onLoad(); };
  composer.value = String(session()?.composerDraft || '');
  composer.addEventListener('input', () => save());
  window.addEventListener('beforeunload', () => save(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });
  return { save, load };
}
