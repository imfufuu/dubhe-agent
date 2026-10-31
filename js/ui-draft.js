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
