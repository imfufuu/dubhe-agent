// 正文流式浮现：新块整段淡入，既有段落的新增尾文本只淡入新字。
// 每次绘制 Markdown 都会整体重建 DOM，因此需要在跨绘制状态中保存各块的纯文本快照。
const SKIP = '.cursor, .connect-line, .trunc-note, .choice-box';

function textNodes(root) {
  const out = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      out.push(node);
      return;
    }
    if (node.nodeType !== 1) return;
    if (node !== root && node.matches(SKIP)) return;
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return out;
}

function blockText(root) {
  return textNodes(root).map((node) => node.nodeValue || '').join('');
}

function revealAppendedText(block, previousText, currentText) {
  if (!currentText.startsWith(previousText) || currentText.length <= previousText.length) return;

  const start = previousText.length;
  const end = currentText.length;
  let offset = 0;
  const ranges = [];
  for (const node of textNodes(block)) {
    const value = node.nodeValue || '';
    const nodeStart = offset;
    const nodeEnd = nodeStart + value.length;
    const rangeStart = Math.max(start, nodeStart);
    const rangeEnd = Math.min(end, nodeEnd);
    if (rangeEnd > rangeStart) ranges.push({ node, start: rangeStart - nodeStart, end: rangeEnd - nodeStart });
    offset = nodeEnd;
  }

  for (const part of ranges) {
    const span = block.ownerDocument.createElement('span');
    span.className = 'chunk-tail';
    const range = block.ownerDocument.createRange();
    range.setStart(part.node, part.start);
    range.setEnd(part.node, part.end);
    try {
      range.surroundContents(span);
    } catch {
      // 若某个浏览器拒绝局部 Range 包裹，保留正文，不影响后续流式渲染。
    }
  }
}

// root：正文容器；state：跨绘制快照（挂在 body 上）；animate：本轮是否为流式中
export function revealChunks(root, state, animate) {
  const doc = root.ownerDocument;
  const blocks = [...root.children].filter((el) => !el.matches(SKIP));
  const previousBlocks = Number.isFinite(state.blocks) ? state.blocks : 0;
  const previousTexts = Array.isArray(state.texts) ? state.texts : [];
  const currentTexts = blocks.map(blockText);
  const fresh = [];

  if (animate) {
    for (let i = 0; i < blocks.length; i++) {
      if (i >= previousBlocks) {
        blocks[i].classList.add('chunk');
        fresh.push(blocks[i]);
      } else {
        revealAppendedText(blocks[i], previousTexts[i] || '', currentTexts[i]);
      }
    }
  }

  state.blocks = blocks.length;
  state.texts = currentTexts;

  // 新块必须立即显示到位：每次绘制都会整体重建 DOM，若依赖下一帧的 rAF 加 .in，
  // 而该帧前又被新一轮绘制替换，块会永远停在 opacity:0（正文「被吞掉」）。
  // 先强制一次回流让浏览器记录起始透明度，再同步加 .in，过渡仍然生效。
  for (const el of fresh) {
    void el.offsetWidth;
    el.classList.add('in');
  }
}
