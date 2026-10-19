// Message-list scroll ownership. Keeps the reader's anchor during repaints and only follows
// the stream while the reader is at the tail; isolated from ui.js so that policy is testable.
export function createMessageScrollManager({ msgList, jumpBtn, isAnimating = () => false, isEmpty = () => false } = {}) {
  let followLatest = true;
  let lastMessageScrollTop = msgList?.scrollTop || 0;

  function jumpToBottom() {
    if (!msgList) return;
    followLatest = true;
    msgList.scrollTop = msgList.scrollHeight;
    lastMessageScrollTop = msgList.scrollTop;
  }

  function captureMessageScroll() {
    if (!msgList) return null;
    const distance = msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight;
    const boxTop = msgList.getBoundingClientRect().top;
    const firstVisible = [...msgList.querySelectorAll('.msg')].find((node) => node.getBoundingClientRect().bottom > boxTop);
    const rect = firstVisible?.getBoundingClientRect();
    return {
      follow: followLatest && distance < 160,
      top: msgList.scrollTop,
      anchorId: firstVisible?.dataset.id || '',
      anchorOffset: rect ? rect.top - boxTop : 0,
    };
  }

  function restoreMessageScroll(snapshot) {
    if (!msgList) return;
    if (!snapshot || snapshot.follow) { jumpToBottom(); return; }
    let restored = false;
    if (snapshot.anchorId) {
      const anchor = msgList.querySelector(`[data-id="${CSS.escape(snapshot.anchorId)}"]`);
      if (anchor) {
        const boxTop = msgList.getBoundingClientRect().top;
        const newOffset = anchor.getBoundingClientRect().top - boxTop;
        msgList.scrollTop += newOffset - snapshot.anchorOffset;
        restored = true;
      }
    }
    if (!restored) {
      const maxTop = Math.max(0, msgList.scrollHeight - msgList.clientHeight);
      msgList.scrollTop = Math.max(0, Math.min(snapshot.top, maxTop));
    }
    followLatest = false;
    lastMessageScrollTop = msgList.scrollTop;
  }

  function scrollToBottom(force, behavior = 'auto') {
    if (!msgList || isAnimating()) return;
    const near = msgList.scrollHeight - msgList.scrollTop - msgList.clientHeight < 160;
    if (force) followLatest = true;
    if (!(force || (followLatest && near))) return;
    if (behavior === 'smooth') msgList.scrollTo({ top: msgList.scrollHeight, behavior: 'smooth' });
    else {
      msgList.scrollTop = msgList.scrollHeight;
      lastMessageScrollTop = msgList.scrollTop;
    }
  }

  msgList?.addEventListener('scroll', () => {
    const top = msgList.scrollTop;
    const dist = msgList.scrollHeight - top - msgList.clientHeight;
    if (dist <= 48) followLatest = true;
    else if (Math.abs(top - lastMessageScrollTop) > 0.5) followLatest = false;
    lastMessageScrollTop = top;
    if (isEmpty()) { jumpBtn?.classList.remove('show'); return; }
    jumpBtn?.classList.toggle('show', dist > 240);
  }, { passive: true });
  jumpBtn?.addEventListener('click', () => {
    jumpBtn.classList.remove('show');
    scrollToBottom(true, 'smooth');
  });

  return { captureMessageScroll, restoreMessageScroll, jumpToBottom, scrollToBottom };
}
