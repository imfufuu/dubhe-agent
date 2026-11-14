// 思考过程标签统一英文；时长格式按秒/分钟自动复数，不满一秒算一秒，整分钟不带秒。
export const THINKING_LABEL = 'Thinking…';
export function formatThoughtDuration(ms) {
  const total = Math.max(1, Math.ceil((Number(ms) || 0) / 1000));
  if (total < 60) return `Thought for ${total} second${total === 1 ? '' : 's'}`;
  const minutes = Math.floor(total / 60), seconds = total % 60;
  const m = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return seconds ? `Thought for ${m} ${seconds} second${seconds === 1 ? '' : 's'}` : `Thought for ${m}`;
}
