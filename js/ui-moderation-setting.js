import { uiText as text, onLanguageChange } from './locale.js';
export const MODERATION_ACK_VERSION = 'moderation-risk-v1';
export function effectiveModeration(settings) { return settings?.contentModeration !== false || settings?.moderationRiskAccepted !== MODERATION_ACK_VERSION; }
// 本地审核关闭时，「灰区图片远程复核」是审核自身的下游设置——此时它已无意义，直接隐藏而不是留一个
// 点不动的开关（否则用户会以为关掉审核后图片仍被送到视觉模型复核）。审核重新开启时原样恢复。
export function syncImageReviewRow(settings, doc = document) {
  const row = doc.getElementById('row-image-review');
  if (!row) return false;
  const on = effectiveModeration(settings);
  row.hidden = !on;
  const input = doc.getElementById('set-image-review');
  if (input) input.disabled = !on;
  return on;
}
export function installModerationSetting({ store, changed = () => {} }) {
  const input = document.getElementById('set-moderation'), modal = document.getElementById('moderation-risk-modal');
  if (!input || !modal) return { sync() {} };
  const ack = document.getElementById('moderation-risk-ack'), confirm = document.getElementById('moderation-risk-confirm');
  const sync = () => { input.checked = effectiveModeration(store.state.settings); syncImageReviewRow(store.state.settings); };
  const close = () => { modal.classList.remove('open'); sync(); input.focus(); };
  const pending = () => { input.checked = true; ack.checked = false; confirm.disabled = true; modal.classList.add('open'); document.getElementById('moderation-risk-cancel').focus(); };
  input.addEventListener('change', () => {
    if (input.checked) { store.state.settings.contentModeration = true; store.notify(); syncImageReviewRow(store.state.settings); changed('contentModeration', true); }
    else pending();
  });
  ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });
  confirm.addEventListener('click', () => {
    if (!ack.checked) return;
    store.state.settings.contentModeration = false; store.state.settings.moderationRiskAccepted = MODERATION_ACK_VERSION;
    store.notify(); syncImageReviewRow(store.state.settings); changed('contentModeration', false); close();
  });
  document.getElementById('moderation-risk-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key === 'Tab') { const controls = [...modal.querySelectorAll('button:not(:disabled),input')], first = controls[0], last = controls.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }, true);
  const note = document.getElementById('set-moderation-note');
  const paintNote = () => { if (note) note.textContent = text('默认开启；称谓始终只在本地检查。普通文本在默认网关可能发送给 Jev 复核，图片灰区可能远程复核；关闭前需确认风险。', 'On by default. Salutations stay local; default-gateway text and uncertain images may be sent for review. Risk acknowledgement is required to disable.'); };
  onLanguageChange(paintNote); paintNote(); store.subscribe?.(sync); sync(); return { sync };
}
