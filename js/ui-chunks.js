// 正文浮现（流式）：按「块」整段淡入，而不是逐字 / 逐 token 淡入。
// 每次绘制 Markdown 都会整体重建 DOM；这里只对「上一次绘制之后新出现的顶层块」加 .chunk，
// 下一帧再加 .in 触发过渡。已经显示过的块、以及正在生长的最后一个块都不动画，所以不会一字一闪。
// 只改顶层元素的 class，不改任何 Markdown 结构。
const SKIP = '.cursor, .connect-line, .trunc-note, .choice-box';

// root：正文容器；state：{ blocks } 跨绘制保存（挂在 body 上）；animate：本轮是否为流式中
export function revealChunks(root, state, animate) {
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const blocks = [...root.children].filter((el) => !el.matches(SKIP));
  const shown = state.blocks || 0;
  const fresh = animate ? blocks.slice(shown) : [];
  for (const el of fresh) el.classList.add('chunk');
  state.blocks = blocks.length;
  // 必须等下一帧再加 .in，否则插入(opacity:0)和触发(opacity:1)会被合并成同一次绘制，transition 不播放
  if (fresh.length && view && view.requestAnimationFrame) {
    view.requestAnimationFrame(() => { for (const el of fresh) el.classList.add('in'); });
  } else {
    for (const el of fresh) el.classList.add('in');
  }
}
