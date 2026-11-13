// Midjourney 四宫格切分（2026-11-09）：上游 /mj/submit/imagine 返回的是 2×2 拼图，
// 这里把单张结果拆成 4 张独立图片；失败时原样返回，绝不丢图。
export const MJ_QUAD_COUNT = 4;

export function quadCrops(width, height) {
  const w = Math.floor(width / 2), h = Math.floor(height / 2);
  return [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({ x, y, width: w, height: h }));
}

/** 浏览器侧用 canvas 切割；splitter 可注入以便单测。 */
export async function splitMjQuad(dataUrl, { splitter, documentImpl = globalThis.document } = {}) {
  const src = String(dataUrl || '');
  if (!src) return [];
  const split = splitter || defaultSplitter(documentImpl);
  if (!split) return [src];
  try {
    const parts = await split(src);
    if (Array.isArray(parts) && parts.length === MJ_QUAD_COUNT && parts.every((p) => typeof p === 'string' && p)) return parts;
  } catch { /* 跨域或解码失败时保留原图 */ }
  return [src];
}

function defaultSplitter(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  return (src) => new Promise((resolve, reject) => {
    const img = new (globalThis.Image || doc.defaultView?.Image)();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const crops = quadCrops(img.naturalWidth || img.width, img.naturalHeight || img.height);
      resolve(crops.map((c) => {
        const canvas = doc.createElement('canvas');
        canvas.width = c.width; canvas.height = c.height;
        canvas.getContext('2d').drawImage(img, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
        return canvas.toDataURL('image/png');
      }));
    };
    img.onerror = () => reject(new Error('MJ 拼图无法解码'));
    img.src = src;
  });
}

/** 把单图结果展开成 4 张（保留 usage / taskId 等元数据）。 */
export async function expandMjResult(result, options = {}) {
  if (!result || !Array.isArray(result.images) || result.images.length !== 1) return result;
  const first = result.images[0] || {};
  const parts = await splitMjQuad(first.dataUrl || '', options);
  if (parts.length !== MJ_QUAD_COUNT) return result;
  const images = parts.map((dataUrl) => ({ ...first, dataUrl }));
  return { ...result, images, ...images[0], quadSplit: true };
}
