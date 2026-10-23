const REASONING_MARKERS = /<\/?(?:think|analysis|reasoning)(?:\s[^>]*)?>/gi;

// Progress-only labels derived from stream length. The UI never displays model reasoning text.
export function reasoningSummaryItems(raw, { maxItems = 3 } = {}) {
  const source = String(raw || '').replace(REASONING_MARKERS, '').replace(/\s/gu, '');
  const length = Array.from(source).length;
  if (!length) return [];
  const stages = [
    [1, '正在分析问题与关键约束…'],
    [48, '正在梳理要点与可行路径…'],
    [160, '正在检查逻辑与边界情况…'],
    [420, '正在组织清晰、简洁的答复…'],
  ];
  return stages.filter(([threshold]) => length >= threshold).slice(-Math.max(1, maxItems)).map(([, label]) => label);
}
