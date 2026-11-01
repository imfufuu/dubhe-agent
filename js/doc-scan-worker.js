// Dubhe Agent · 文稿扫描实时角点检测 Worker（第 18 条）
// 只做纯计算：接收降采样后的 RGBA 像素，返回四角（小图坐标）或 null。不碰 DOM。
import { detectDocCorners } from './doc-scanner.js';

self.onmessage = (event) => {
  const { id, width, height, buffer } = event.data || {};
  let quad = null;
  try {
    quad = detectDocCorners({ data: new Uint8ClampedArray(buffer), width, height }) || null;
  } catch {
    quad = null;
  }
  self.postMessage({ id, quad });
};
