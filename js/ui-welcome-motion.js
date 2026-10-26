function motionEnabled(doc) {
  const mode = doc.documentElement?.dataset.motion;
  return mode === 'on' || (mode !== 'off' && !doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function translateY(transform) {
  const match = /^matrix(?:3d)?\(([^)]+)\)$/.exec(transform || '');
  if (!match) return 0;
  const values = match[1].split(',').map(Number);
  return values.length === 16 ? (values[13] || 0) : (values[5] || 0);
}

export function installWelcomeMotion({ main, messages, composerWrap, composer, isEmptyChat }) {
  const doc = main?.ownerDocument;
  const win = doc?.defaultView;
  let greetingRun = 0, greetingTimer = 0, subtitleTimer = 0, dockFrame = 0;

  function cancelGreeting() {
    greetingRun++;
    win?.clearTimeout(greetingTimer);
    win?.clearTimeout(subtitleTimer);
    if (dockFrame) win?.cancelAnimationFrame?.(dockFrame);
    greetingTimer = subtitleTimer = dockFrame = 0;
  }

  function setGreeting(title, subtitle, { animate = true } = {}) {
    const heading = messages?.querySelector('#welcome-greeting');
    const prompt = messages?.querySelector('#welcome-prompt');
    if (!heading) return;
    cancelGreeting();
    const run = greetingRun;
    const fullTitle = String(title ?? '');
    const fullSubtitle = String(subtitle ?? '');
    heading.setAttribute('aria-label', fullTitle);
    heading.removeAttribute('data-typing');
    if (prompt) {
      prompt.classList.remove('is-visible');
      prompt.textContent = fullSubtitle;
    }
    const shouldAnimate = animate && !composer?.value && motionEnabled(doc);
    if (!shouldAnimate) {
      heading.textContent = fullTitle;
      if (prompt) prompt.classList.add('is-visible');
      main?.classList.remove('welcome-entering');
      return;
    }
    heading.textContent = '';
    heading.dataset.typing = 'true';
    main?.classList.add('welcome-entering');
    const chars = Array.from(fullTitle);
    let index = 0;
    const revealNext = () => {
      if (run !== greetingRun || !heading.isConnected) return;
      if (!motionEnabled(doc)) {
        heading.textContent = fullTitle;
        heading.removeAttribute('data-typing');
        if (prompt) prompt.classList.add('is-visible');
        main?.classList.remove('welcome-entering');
        return;
      }
      index++;
      heading.textContent = chars.slice(0, index).join('');
      if (index < chars.length) greetingTimer = win.setTimeout(revealNext, 32);
      else {
        heading.removeAttribute('data-typing');
        main?.classList.remove('welcome-entering');
        if (prompt) subtitleTimer = win.setTimeout(() => {
          if (run === greetingRun && prompt.isConnected) prompt.classList.add('is-visible');
        }, 90);
      }
    };
    if (!chars.length) {
      heading.removeAttribute('data-typing');
      if (prompt) prompt.classList.add('is-visible');
    } else greetingTimer = win.setTimeout(revealNext, 48);
  }

  function composerShift() {
    const heading = messages?.querySelector('#welcome-prompt');
    if (!heading || !composerWrap || !main) return NaN;
    const wrapRect = composerWrap.getBoundingClientRect();
    const promptRect = heading.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    const style = win.getComputedStyle(composerWrap);
    const topPadding = Number.parseFloat(style.paddingTop) || 8;
    const currentY = translateY(win.getComputedStyle(composerWrap).transform);
    const baseTop = wrapRect.top - currentY;
    const height = wrapRect.height;
    const desiredTop = promptRect.bottom + 14 - topPadding;
    const visibleTop = Math.max(mainRect.top, desiredTop);
    const visibleBottom = Math.min(visibleTop, mainRect.bottom - height - 4);
    return visibleBottom - baseTop;
  }

  function setDocked() {
    main?.classList.remove('welcome-draft');
    if (main?.classList.contains('welcome-docked')) {
      const shift = composerShift();
      if (Number.isFinite(shift)) main.style.setProperty('--welcome-shift-y', `${Math.round(shift)}px`);
      return;
    }
    composerWrap?.getBoundingClientRect();
    const shift = composerShift();
    if (!Number.isFinite(shift)) return;
    if (motionEnabled(doc) && win?.requestAnimationFrame) {
      main.style.setProperty('--welcome-shift-y', '0px');
      main.classList.add('welcome-docked');
      composerWrap.getBoundingClientRect();
      dockFrame = win.requestAnimationFrame(() => {
        dockFrame = 0;
        if (main.classList.contains('welcome-docked') && !composer?.value) {
          const nextShift = composerShift();
          if (Number.isFinite(nextShift)) main.style.setProperty('--welcome-shift-y', `${Math.round(nextShift)}px`);
        }
      });
    } else {
      main.style.setProperty('--welcome-shift-y', `${Math.round(shift)}px`);
      main.classList.add('welcome-docked');
    }
  }

  function sync({ empty } = {}) {
    const hasEmptyState = !!messages?.querySelector('.empty-state') && (empty ?? isEmptyChat?.() ?? true);
    if (!hasEmptyState) {
      cancelGreeting();
      main?.classList.remove('welcome-docked', 'welcome-draft', 'welcome-entering');
      main?.style.removeProperty('--welcome-shift-y');
      return;
    }
    if (composer?.value) {
      cancelGreeting();
      const heading = messages.querySelector('#welcome-greeting');
      if (heading?.hasAttribute('data-typing')) {
        heading.textContent = heading.getAttribute('aria-label') || heading.textContent;
        heading.removeAttribute('data-typing');
      }
      messages.querySelector('#welcome-prompt')?.classList.add('is-visible');
      main.classList.remove('welcome-docked');
      main.classList.add('welcome-draft');
      main.style.removeProperty('--welcome-shift-y');
      return;
    }
    setDocked();
  }

  const resizeObserver = win?.ResizeObserver ? new win.ResizeObserver(() => {
    if (main?.classList.contains('welcome-docked')) {
      const shift = composerShift();
      if (Number.isFinite(shift)) main.style.setProperty('--welcome-shift-y', `${Math.round(shift)}px`);
    }
  }) : null;
  if (resizeObserver) {
    [main, messages, composerWrap].filter(Boolean).forEach((node) => resizeObserver.observe(node));
  } else win?.addEventListener('resize', () => {
    if (main?.classList.contains('welcome-docked')) {
      const shift = composerShift();
      if (Number.isFinite(shift)) main.style.setProperty('--welcome-shift-y', `${Math.round(shift)}px`);
    }
  }, { passive: true });

  return { setGreeting, sync };
}
