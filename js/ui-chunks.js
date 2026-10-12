// 正文浮现（流式）：Markdown 整体渲染不变，渲染后只给正文里的文本节点包一层 .chunk。
// 只有「上一次绘制之后新增的字符」才淡入；之前已经显示过的字符直接是可见态，避免整段重新闪。
// 代码块、公式、图表、按钮、提示行等不参与，保证 Markdown 结构完整。
const SKIP = 'pre, code, svg, .katex, .cursor, .connect-line, .trunc-note, .choice-box, .md-chart, .md-diagram, button, input, textarea, select, img, video, audio';

// root：正文容器（已完成 innerHTML 重绘）；state：{ revealed } 挂在消息节点上，跨绘制保存；animate：是否为本轮流式中的新字符做淡入
export function revealChunks(root, state, animate) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement || n.parentElement.closest(SKIP)) continue;
    nodes.push(n);
  }
  const shown = state.revealed || 0;
  let offset = 0;
  const fresh = [];
  for (const n of nodes) {
    const text = n.nodeValue || '';
    const len = text.length;
    const cut = Math.min(len, Math.max(0, shown - offset));   // 已显示部分的长度
    // 没有新增字符的节点保持普通文本（本来就可见）；只包住新增的尾部
    if (cut < len && text.slice(cut).trim()) {
      const frag = doc.createDocumentFragment();
      if (cut > 0) frag.appendChild(doc.createTextNode(text.slice(0, cut)));
      const span = doc.createElement('span');
      span.className = animate ? 'chunk' : 'chunk in';
      span.textContent = text.slice(cut);
      frag.appendChild(span);
      if (animate) fresh.push(span);
      n.parentNode.replaceChild(frag, n);
    }
    offset += len;
  }
  state.revealed = offset;
  // 必须等下一帧再加 .in，否则插入(opacity:0)和触发(opacity:1)会被合并成同一次绘制，transition 不播放
  if (fresh.length && view && view.requestAnimationFrame) {
    view.requestAnimationFrame(() => { for (const s of fresh) s.classList.add('in'); });
  } else {
    for (const s of fresh) s.classList.add('in');
  }
}
