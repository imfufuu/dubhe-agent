const lineStates = new WeakMap();

function motionEnabled(doc) {
  const mode = doc.documentElement?.dataset.motion;
  return mode === 'on' || (mode !== 'off' && !doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function revealLine(node, delay) {
  const win = node.ownerDocument.defaultView;
  node.classList.add('reasoning-line-entering');
  node.style.setProperty('--reasoning-reveal-delay', `${delay}ms`);
  const finish = () => {
    node.classList.remove('reasoning-line-entering', 'is-visible');
    node.style.removeProperty('--reasoning-reveal-delay');
  };
  node.addEventListener('animationend', finish, { once: true });
  const animate = win.requestAnimationFrame ? (callback) => win.requestAnimationFrame(callback) : (callback) => win.setTimeout(callback, 16);
  animate(() => { if (node.isConnected) node.classList.add('is-visible'); });
  win.setTimeout(finish, 700 + delay);
}

export function renderReasoningLines(container, value, { summary = false, animate = false } = {}) {
  if (!container) return 0;
  const doc = container.ownerDocument;
  const mode = summary ? 'summary' : 'full';
  const items = summary
    ? (Array.isArray(value) ? value.map((item) => String(item ?? '')) : [])
    : String(value ?? '').split(/\r\n|\r|\n/);
  let state = lineStates.get(container);
  if (!state || state.mode !== mode || items.length < state.nodes.length) {
    container.replaceChildren();
    state = { mode, nodes: [] };
    lineStates.set(container, state);
  }
  const shouldAnimate = animate && motionEnabled(doc);
  for (let index = 0; index < Math.min(items.length, state.nodes.length); index++) {
    if (state.nodes[index].textContent !== items[index]) state.nodes[index].textContent = items[index];
  }
  const firstNew = state.nodes.length;
  for (let index = firstNew; index < items.length; index++) {
    const line = doc.createElement(summary ? 'div' : 'span');
    line.className = summary ? 'think-summary-item' : 'reasoning-line';
    line.textContent = items[index];
    if (!summary && index > 0) container.appendChild(doc.createTextNode('\n'));
    container.appendChild(line);
    state.nodes.push(line);
    if (shouldAnimate) revealLine(line, Math.min((index - firstNew) * 48, 192));
  }
  return items.length;
}
