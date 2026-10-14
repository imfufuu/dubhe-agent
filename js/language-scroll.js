// Homepage translations change paragraph heights. Preserve a visible anchor
// under the language fade rather than letting smooth scroll/scroll anchoring
// move the footer or the section the visitor is currently reading.
const pending = new WeakMap();
export function preserveLanguageViewport(doc, run) {
  const win = doc.defaultView;
  if (!win || !doc.querySelector('.site #hero')) return run();
  pending.get(doc)?.();
  const root = doc.documentElement, body = doc.body;
  const x = win.scrollX, y = win.scrollY, viewport = win.innerHeight;
  const inView = node => { const r = node?.getBoundingClientRect(); return r && r.height > 0 && r.top >= 0 && r.bottom <= viewport; };
  const focused = doc.activeElement?.closest?.('[data-language-toggle]');
  const anchor = inView(focused) ? focused
    : [...doc.querySelectorAll('.site main section, .site footer')].find(node => { const r = node.getBoundingClientRect(); return r.top <= viewport * 0.4 && r.bottom > viewport * 0.4; });
  const anchorTop = anchor?.getBoundingClientRect().top;
  const bottomGap = Math.max(0, root.scrollHeight - viewport - y);
  const saved = [[root, 'scroll-behavior'], [root, 'overflow-anchor'], [body, 'overflow-anchor']].map(([node, prop]) => [node, prop, node.style.getPropertyValue(prop), node.style.getPropertyPriority(prop)]);
  root.style.setProperty('scroll-behavior', 'auto', 'important');
  root.style.setProperty('overflow-anchor', 'none', 'important'); body.style.setProperty('overflow-anchor', 'none', 'important');
  let active = true, timer;
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const release = () => {
    if (!active) return; active = false; clearTimeout(timer);
    for (const [node, prop, value, priority] of saved) value ? node.style.setProperty(prop, value, priority) : node.style.removeProperty(prop);
    for (const name of events) win.removeEventListener(name, release, true);
    if (pending.get(doc) === release) pending.delete(doc);
  };
  pending.set(doc, release);
  for (const name of events) win.addEventListener(name, release, { capture: true, passive: true });
  const restore = () => {
    if (!active) return;
    const max = Math.max(0, root.scrollHeight - win.innerHeight);
    const target = y < 2 ? 0 : anchor?.isConnected ? win.scrollY + anchor.getBoundingClientRect().top - anchorTop : bottomGap < 2 ? max : y;
    win.scrollTo({ left: x, top: Math.max(0, Math.min(max, target)), behavior: 'instant' });
  };
  try { run(); restore(); } catch (error) { release(); throw error; }
  // Finish after layout/font updates, but never fight an explicit user scroll.
  win.requestAnimationFrame(() => { restore(); win.requestAnimationFrame(restore); });
  Promise.resolve(doc.fonts?.ready).then(restore).catch(() => {});
  timer = setTimeout(release, 500);
}
