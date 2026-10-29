import { revealChunks } from './ui-chunks.js';

// 思考过程与正文使用同一套浮现机制（ui-chunks.js）：
// 新块整段淡入；既有块新增的尾文本只淡入新字。没有位移，因此不会“弹入”。
// 每次绘制都会整体重建 DOM（与正文一致），跨绘制的文本快照保存在容器上。
const scrollFrames = new WeakMap();

function followLatest(container) {
  const win = container.ownerDocument.defaultView;
  const scroll = () => {
    if (!container.isConnected) return;
    container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  };
  scroll();
  if (!win?.requestAnimationFrame) return;
  const pending = scrollFrames.get(container);
  if (pending != null) win.cancelAnimationFrame?.(pending);
  const frame = win.requestAnimationFrame(() => {
    scrollFrames.delete(container);
    scroll();
  });
  scrollFrames.set(container, frame);
}

function motionEnabled(doc) {
  const mode = doc.documentElement?.dataset.motion;
  return mode === 'on' || (mode !== 'off' && !doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

// html：非 GPT 模型为 Markdown 渲染结果；GPT 摘要为转义后的条目 HTML。
// animate：思考仍在进行时为 true；结束后的重绘不再产生动画。
export function paintReasoningBlocks(container, html, { animate = false } = {}) {
  if (!container) return 0;
  const doc = container.ownerDocument;
  container.innerHTML = html;
  const state = container._reasoningChunkState || (container._reasoningChunkState = {});
  revealChunks(container, state, animate && motionEnabled(doc));
  followLatest(container);
  return container.children.length;
}
