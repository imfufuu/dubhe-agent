const REASONING_MARKERS = /<\/?(?:think|analysis|reasoning)(?:\s[^>]*)?>/gi;
const BOLD_SUMMARY = /\*\*([\s\S]+?)\*\*/g;

export function isGptModel(modelId) {
  const model = String(modelId || '').trim().toLowerCase();
  if (!model) return false;
  if (/(?:^|[^a-z0-9])(?:gpt|chatgpt)[-_.:/\s]*(?:image|audio|tts|transcribe|realtime)(?:$|[^a-z0-9])/.test(model)) return false;
  return /(?:^|[^a-z0-9])gpt(?:$|[-_.:/\s])/.test(model)
    || /(?:^|[^a-z0-9])chatgpt(?:$|[-_.:/\s])/.test(model);
}

// Only GPT-family models use the chained-bold summary convention, e.g.
// **Understand the request****Check constraints**. Preserve every marker pair,
// including repeated labels, as a separate item and in its original order.
// Other models return no summaries; their reasoning is rendered separately.
export function reasoningSummaryItems(raw, modelId) {
  if (!isGptModel(modelId)) return [];
  const source = String(raw || '').replace(REASONING_MARKERS, '');
  const items = [];
  for (const match of source.matchAll(BOLD_SUMMARY)) {
    const item = String(match[1] || '').replace(/\s+/gu, ' ').trim();
    if (item) items.push(item);
  }
  return items;
}
