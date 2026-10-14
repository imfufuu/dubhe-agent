import { feedbackTarget, normalizeFeedback } from './feedback.js';
import { ICON } from './icons.js?v=2026.10.11.1';
const svg = (down) => down ? ICON.thumbDown : ICON.thumbUp;
export function installFeedback({ store, agent, getBusy, root, toast }) {
  const refresh = () => {
    const target = feedbackTarget(store.state.messages, getBusy());
    for (const bar of root.querySelectorAll('.feedback-actions')) if (!target || bar.dataset.feedbackFor !== String(target.id)) bar.remove();
    if (!target) return;
    const wrap = [...root.querySelectorAll('.msg[data-id]')].find((n) => n.dataset.id === String(target.id));
    const host = wrap?.querySelector('.msg-actions');
    if (!host || !wrap.querySelector('.md-body')?.textContent?.trim()) return;
    let bar = host.querySelector('.feedback-actions');
    if (!bar) {
      bar = document.createElement('span'); bar.className = 'feedback-actions'; bar.dataset.feedbackFor = target.id;
      bar.setAttribute('title', '评价可选，仅对上一条正常完成的答复；会作为下一轮模型参考');
      bar.innerHTML = ['up', 'down'].map((vote) => `<button type="button" class="act feedback-btn" data-vote="${vote}" aria-label="${vote === 'up' ? '有帮助' : '没有帮助'}" title="${vote === 'up' ? '赞' : '踩'}" aria-pressed="false">${svg(vote === 'down')}</button>`).join('');
      host.append(bar);
    }
    const vote = normalizeFeedback(target.feedback)?.vote;
    for (const b of bar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.vote === vote));
  };
  root.addEventListener('click', (e) => {
    const button = e.target.closest?.('.feedback-btn'); if (!button) return;
    const m = feedbackTarget(store.state.messages, getBusy());
    if (!m || button.closest('.feedback-actions')?.dataset.feedbackFor !== String(m.id)) return;
    const vote = button.dataset.vote;
    if (!['up', 'down'].includes(vote)) return;
    const next = m.feedback?.vote === vote ? undefined : { vote, ts: Date.now() };
    store.updateMessage(m.id, { feedback: next }); refresh();
    // 状态由 aria-pressed + 颜色/小动效表达，不再弹提示条（避免打断阅读）。
  });
  let pending = false;
  const observer = new root.ownerDocument.defaultView.MutationObserver(() => { if (pending) return; pending = true; queueMicrotask(() => { pending = false; observer.disconnect(); refresh(); observe(); }); });
  const observe = () => observer.observe(root, { childList: true, subtree: true });
  store.subscribe(refresh); refresh(); observe();
  return { refresh, disconnect: () => observer.disconnect() };
}
