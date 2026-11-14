// 对话模式 UI 降级 + 最终产物报告打开（从 ui.js 抽出，保持主文件在 3000 行预算内）。
import { resolveTurnEnvironment } from './agent-runtime.js';

export function installChatModeUI({ store, doc = globalThis.document, thinkingToggle, thinkMenu, syncThinking, getAttachments, $ }) {
  if (!store || !doc?.documentElement) return { sync: () => {} };
  const pick = (id) => ($ ? $(id) : doc.getElementById(id));
  const sync = () => {
    let chat = String((store.state.tuner || {}).environment || '') === 'chat';
    try {
      chat = resolveTurnEnvironment({ tuner: store.state.tuner, settings: store.state.settings || {}, gatewayId: store.state.gatewayId }).environment === 'chat';
    } catch { /* 解析失败时沿用显式值 */ }
    doc.documentElement.setAttribute('data-chat-mode', chat ? '1' : '0');
    if (thinkingToggle) {
      if (chat) {
        thinkingToggle.removeAttribute('aria-haspopup');
        thinkingToggle.setAttribute('aria-pressed', store.state.settings?.thinking !== false ? 'true' : 'false');
      } else {
        thinkingToggle.setAttribute('aria-haspopup', 'listbox');
        thinkingToggle.removeAttribute('aria-pressed');
      }
    }
    if (thinkMenu) thinkMenu.hidden = chat;
    for (const id of ['sandbox-toggle', 'web-toggle', 'fast-toggle', 'project-toggle', 'panel-toggle']) { const el = pick(id); if (el) el.hidden = chat; }
    const attachments = typeof getAttachments === 'function' ? getAttachments() : null;
    if (attachments && typeof attachments.setChatMode === 'function') attachments.setChatMode(chat);
    try { syncThinking && syncThinking(); } catch { /* 尚未初始化 */ }
  };
  if (typeof store.subscribe === 'function') store.subscribe(sync);
  sync();
  return { sync };
}

export function installFinalReportOpener({ doc = globalThis.document, setPanelCollapsed, openFileViewer } = {}) {
  if (!doc?.addEventListener) return null;
  const onReport = (event) => {
    const path = String(event?.detail?.path || '').trim();
    if (!path) return;
    try { setPanelCollapsed && setPanelCollapsed(false); } catch { /* 面板未挂载 */ }
    try { openFileViewer && openFileViewer(path); } catch { /* 文件已清理 */ }
  };
  doc.addEventListener('dubhe:final-report', onReport);
  return { dispose() { doc.removeEventListener('dubhe:final-report', onReport); } };
}

/** 对话模式：思考按钮只做开关（无等级菜单）。 */
export function toggleChatThinking({ store, syncThinking, closeThinkMenu }) {
  store.state.settings.thinking = store.state.settings.thinking === false;
  store.notify();
  try { syncThinking && syncThinking(); } catch { /* noop */ }
  try { closeThinkMenu && closeThinkMenu(); } catch { /* noop */ }
}

export function chatModeThinkingTitle(localeText) {
  return localeText('思考开关 · 按下切换', 'Thinking on/off');
}

/** 对话模式：文本附件已解析成正文，直接拼进消息，不传附件对象。 */
export function sendChatTurn({ text, atts, send }) {
  const inline = (atts || []).filter((a) => a && a.kind === 'text' && typeof a.text === 'string');
  const merged = inline.length
    ? inline.map((a) => `【${a.name}】\n${a.text}`).join('\n\n') + (text ? `\n\n${text}` : '')
    : text;
  send(merged, []);
  return merged;
}
