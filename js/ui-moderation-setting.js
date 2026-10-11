import { text, onLanguageChange } from './locale.js';
export const MODERATION_ACK_VERSION = 'moderation-risk-v1';
export function effectiveModeration(settings) { return settings?.contentModeration !== false || settings?.moderationRiskAccepted !== MODERATION_ACK_VERSION; }
export function installModerationSetting({ store, changed = () => {} }) {
  const input = document.getElementById('set-moderation'), modal = document.getElementById('moderation-risk-modal');
  if (!input || !modal) return { sync() {} };
  const ack = document.getElementById('moderation-risk-ack'), confirm = document.getElementById('moderation-risk-confirm');
  const sync = () => { input.checked = effectiveModeration(store.state.settings); };
  const close = () => { modal.classList.remove('open'); sync(); input.focus(); };
  const pending = () => { input.checked = true; ack.checked = false; confirm.disabled = true; modal.classList.add('open'); document.getElementById('moderation-risk-cancel').focus(); };
  input.addEventListener('change', () => {
    if (input.checked) { store.state.settings.contentModeration = true; store.notify(); changed('contentModeration', true); }
    else pending();
  });
  ack.addEventListener('change', () => { confirm.disabled = !ack.checked; });
  confirm.addEventListener('click', () => {
    if (!ack.checked) return;
    store.state.settings.contentModeration = false; store.state.settings.moderationRiskAccepted = MODERATION_ACK_VERSION;
    store.notify(); changed('contentModeration', false); close();
  });
  document.getElementById('moderation-risk-cancel').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (!modal.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
    if (e.key === 'Tab') { const controls = [...modal.querySelectorAll('button:not(:disabled),input')], first = controls[0], last = controls.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }, true);
  const note = document.getElementById('set-moderation-note');
  const paintNote = () => { if (note) note.textContent = text('默认开启；关闭前需确认风险与责任，仅影响本地检查，不改变上游政策', 'On by default. Disabling requires risk acknowledgement; upstream policies still apply.'); };
  onLanguageChange(paintNote); paintNote(); store.subscribe?.(sync); sync(); return { sync };
}
