import { $, el, esc } from './ui-markdown.js?v=2026.10.25.1';
import { getIntlLocale } from './locale.js';
import { formatRelativeTime } from './i18n.js?v=2026.10.25.1';
// ── Toast（底部最多堆叠 3 条，超出自动隐藏并移除最旧消息）──────────────────
export const MAX_TOAST_STACK = 3;
export function toast(msg, type = 'info', ms = 2600) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const active = [...wrap.querySelectorAll('.toast:not(.leaving)')];
  while (active.length >= MAX_TOAST_STACK) {
    const oldest = active.shift();
    if (oldest) {
      oldest.classList.remove('in');
      oldest.classList.add('leaving');
      setTimeout(() => oldest.remove(), 220);
    }
  }
  const t = el('div', `toast ${type}`, `<span>${esc(msg)}</span>`);
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const dismiss = () => { if (!t.isConnected) return; t.classList.remove('in'); t.classList.add('leaving'); setTimeout(() => t.remove(), 350); };
  setTimeout(dismiss, ms);
  t.dismiss = dismiss; // 调用方可提前收掉（例如「正在处理视频…」在处理完成时）
  return t;
}

export function fmtClock(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const locale = getIntlLocale();
  const minute = new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'narrow', maximumFractionDigits: 0 });
  const second = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 0 });
  return minutes <= 0 ? second.format(seconds) : `${minute.format(minutes)} ${second.format(seconds)}`;
}
export function fmtAgo(ts) { return formatRelativeTime(ts); }
