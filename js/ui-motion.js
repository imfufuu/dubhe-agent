export function motionReduced(doc = document) {
  const mode = doc.documentElement.dataset.motion;
  return mode === 'off' || (mode !== 'on' && !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// Keep the popover mounted until its exit finishes; a fast reopen cancels that exit.
export function animatedPopover(menu, button) {
  let open = !menu.hidden, animation = null;
  const set = (next) => {
    next = !!next;
    if (next === open) return;
    open = next;
    const visual = menu.ownerDocument.defaultView.getComputedStyle(menu);
    const opacity = visual.opacity, transform = visual.transform;
    animation?.cancel(); animation = null;
    button.setAttribute('aria-expanded', String(open));
    menu.inert = !open;
    if (motionReduced(menu.ownerDocument) || !menu.animate) { menu.hidden = !open; return; }
    const wasHidden = menu.hidden; menu.hidden = false;
    // V1.8.1：与思考菜单（.dd-menu）共用同一套气泡语言：--pop-dy / --pop-scale，spring 弹出、快抽回
    const gcs = menu.ownerDocument.defaultView.getComputedStyle;
    const dy = gcs(menu).getPropertyValue('--pop-dy').trim() || '12px';
    const scale = gcs(menu).getPropertyValue('--pop-scale').trim() || gcs(menu.ownerDocument.documentElement).getPropertyValue('--pop-scale').trim() || '.78';
    const closedT = `translate3d(0, ${dy}, 0) scale(${scale})`;
    const a = menu.animate([
      { opacity: wasHidden ? 0 : opacity, transform: wasHidden ? closedT : transform },
      { opacity: open ? 1 : 0, transform: open ? 'translate3d(0, 0, 0) scale(1)' : closedT },
    ], { duration: open ? 440 : 150, easing: open ? 'cubic-bezier(.18, 1.42, .28, 1)' : 'cubic-bezier(.4, 0, .9, .6)' });
    animation = a;
    a.onfinish = () => { if (animation !== a) return; menu.hidden = !open; animation = null; };
  };
  return { set, toggle: () => set(!open) };
}

// Shared by the homepage Q&A and release summaries, including rapid reversal.
export function installSmoothDetails(root, selector = 'details') {
  for (const detail of root.querySelectorAll(selector)) {
    if (detail._smoothDetails) continue;
    detail._smoothDetails = true;
    const summary = detail.querySelector('summary'); if (!summary) continue;
    let animation = null, wanted = detail.open;
    summary.addEventListener('click', (event) => {
      event.preventDefault();
      const start = detail.getBoundingClientRect().height;
      wanted = !wanted; animation?.cancel(); animation = null;
      detail.classList.toggle('is-open', wanted);
      detail.classList.toggle('is-closing', !wanted);
      if (motionReduced(detail.ownerDocument) || !detail.animate) { detail.open = wanted; detail.style.overflow = ''; detail.classList.remove('is-closing'); return; }
      detail.open = wanted;
      const end = detail.getBoundingClientRect().height;
      detail.open = true; detail.style.overflow = 'hidden';
      const a = detail.animate([{ height: `${start}px` }, { height: `${end}px` }], {
        duration: wanted ? 300 : 260, easing: 'cubic-bezier(.22,1,.36,1)',
      });
      animation = a;
      a.onfinish = () => { if (animation !== a) return; detail.open = wanted; detail.style.overflow = ''; detail.classList.remove('is-closing'); animation = null; };
    });
  }
}
